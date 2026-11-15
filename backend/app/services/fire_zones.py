"""Release-wide historical fire recurrence polygons, shared by every area query."""

import json
import math
import os
from functools import lru_cache
from pathlib import Path

import shapely
from shapely.affinity import translate
from shapely.geometry import shape
from shapely.strtree import STRtree

from app.services import historical_data as data


METHOD = "modis-fire-recurrence-v1"
EARTH_KM = 6371.0088


def index_path(release):
    directory = Path(os.getenv("FIRMS_ZONE_DIR", data.REPO / "data/work/fire-zones"))
    return directory / f"{METHOD}-{release.digest}.geojson"


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        if not geometry.is_empty:
            yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygon_parts(part)


def wrap_polygon(polygon):
    """Split an unwrapped polygon into RFC 7946 longitude bounds."""
    if polygon.is_empty:
        return shapely.geometry.MultiPolygon()
    west, _, east, _ = polygon.bounds
    pieces = []
    for turn in range(math.floor((west + 180) / 360), math.floor((east + 180) / 360) + 1):
        offset = 360 * turn
        cut = polygon.intersection(shapely.box(-180 + offset, -90, 180 + offset, 90))
        pieces.extend(translate(part, xoff=-offset) for part in polygon_parts(cut))
    return shapely.geometry.MultiPolygon(pieces)


def circle_geometry(center, radius_km):
    lon, lat = map(math.radians, center)
    distance = radius_km / EARTH_KM
    coordinates = []
    for step in range(180):
        bearing = math.tau * step / 180
        y = math.asin(max(-1, min(1, math.sin(lat) * math.cos(distance)
                                  + math.cos(lat) * math.sin(distance) * math.cos(bearing))))
        x = lon + math.atan2(math.sin(bearing) * math.sin(distance) * math.cos(lat),
                             math.cos(distance) - math.sin(lat) * math.sin(y))
        longitude = math.degrees(x)
        if coordinates:
            longitude += 360 * round((coordinates[-1][0] - longitude) / 360)
        coordinates.append((longitude, math.degrees(y)))
    if abs(coordinates[-1][0] - coordinates[0][0]) > 180:
        end, start = coordinates[-1][0], coordinates[0][0]
        pole = 90 if center[1] >= 0 else -90
        coordinates.extend(((end, pole), (start, pole)))
    return wrap_polygon(shapely.geometry.Polygon(coordinates).buffer(0))


@lru_cache(maxsize=2)
def load_index(path, modified_ns, digest):
    with path.open(encoding="utf-8") as stream:
        index = json.load(stream)
    if index["dataset_manifest_sha256"] != digest or index["method"] != METHOD:
        raise data.DatasetUnavailable("Fire zone index does not match the verified release")
    features = index["features"]
    geometries = [shape(feature["geometry"]) for feature in features]
    parts, owners = [], []
    for identifier, geometry in enumerate(geometries):
        for part in polygon_parts(geometry):
            parts.append(part)
            owners.append(identifier)
    metadata = {key: value for key, value in index.items() if key != "features"}
    return metadata, features, STRtree(parts), owners


def zones_for(release, area):
    geometry, _ = data.geometry_for(area)
    path = index_path(release)
    try:
        metadata, features, tree, owners = load_index(path, path.stat().st_mtime_ns, release.digest)
    except (OSError, ValueError, KeyError) as error:
        raise data.DatasetUnavailable("Build the historical fire zone index with backend/scripts/build_fire_zones.py") from error
    if area.kind == "circle":
        # Large circles are the complement of a smaller circle around the antipode.
        if area.radius_km >= math.pi * EARTH_KM / 2:
            antipode = ((area.center[0] + 360) % 360 - 180, -area.center[1])
            opposite = math.pi * EARTH_KM - area.radius_km
            geometry = shapely.box(-180, -90, 180, 90)
            if opposite > 0:
                geometry = geometry.difference(circle_geometry(antipode, opposite))
        else:
            geometry = circle_geometry(area.center, area.radius_km)
    matches = {owners[int(i)] for part in polygon_parts(geometry)
               for i in tree.query(part, predicate="intersects")}
    # Preserve world-stable boundaries for both parcel-size and country-size selections.
    return {**metadata, "features": [features[i] for i in sorted(matches)]}
