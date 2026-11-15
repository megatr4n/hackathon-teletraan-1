"""Build the local fire-zone index from a verified FIRMS release."""

import argparse
import json
import math
import os
from collections import defaultdict
from datetime import date
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile

import duckdb
import h3
import numpy as np
import shapely
from shapely.geometry import MultiPoint, mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import fire_zones as zones, historical_data as data


CELL_KM = 5
NEIGHBOR_KM = 12
CLUSTER_KM = 28
MIN_POINTS = 3
MIN_RECURRENCE = 0.60
MAX_CANDIDATE_FRACTION = 0.10
BANDS = (("outer", MIN_RECURRENCE, 4), ("elevated", 0.80, 3), ("core", 0.90, 2))


def select_hotspots(release, start, end):
    files = release.paths(("terra", "aqua"), start, end, "observations")
    with duckdb.connect(config={"threads": 4, "memory_limit": "1500MB", "preserve_insertion_order": False}) as db:
        frame = db.execute(
            """
            WITH valid AS (
                SELECT longitude AS lon, latitude AS lat, year,
                    floor((least(latitude, 89.9999999) + 90) * 111.195 / $km) AS row
                FROM read_parquet($files, hive_partitioning=true)
                WHERE satellite IN ('Terra', 'Aqua') AND fire_type = '0'
                    AND TRY_CAST(confidence AS INTEGER) >= 30
                    AND longitude BETWEEN -180 AND 180 AND latitude BETWEEN -90 AND 90
                    AND obs_date BETWEEN $first AND $last
            ), grid AS (
                SELECT *, row * $km / 111.195 - 90 AS south,
                    $km / (111.195 * cos(radians(least(89.9999, (row + .5) * $km / 111.195 - 90)))) AS width
                FROM valid
            ), indexed AS (
                SELECT *, floor((least(lon, 179.9999999) + 180) / width) AS col
                FROM grid
            ), yearly AS (
                SELECT bit_count(bit_or(1::UBIGINT << (year - $first_year))) AS years,
                    arg_min(struct_pack(lon := lon, lat := lat), (
                      pow((lon + 180) / width - col - .5, 2) +
                      pow((lat - south) * 111.195 / $km - .5, 2), lon, lat
                    )) AS sample
                FROM indexed GROUP BY row, col
            ), ranked AS (
                SELECT *, count(*) OVER () AS total, rank() OVER (ORDER BY years DESC) AS position,
                    count(*) OVER (PARTITION BY years) AS ties
                FROM yearly
            )
            SELECT sample.lon AS lon, sample.lat AS lat, years
            FROM ranked WHERE years >= $minimum
              AND position + ties - 1 <= floor(total * $fraction)
            ORDER BY years DESC, lon, lat
            """,
            {"km": CELL_KM, "files": files, "first": start, "last": end,
             "first_year": start.year, "minimum": math.ceil((end.year - start.year + 1) * MIN_RECURRENCE),
             "fraction": MAX_CANDIDATE_FRACTION},
        ).fetchnumpy()
    return np.column_stack((frame["lon"], frame["lat"], frame["years"]))


def distance_squared(a, b):
    return 4 * math.sin(a / (2 * b)) ** 2


def unit_vectors(points):
    lon, lat = np.radians(points[:, :2]).T
    return np.column_stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)))


def components(indices, neighbors):
    remaining = set(indices)
    for seed in indices:
        if seed not in remaining:
            continue
        group = [seed]
        remaining.remove(seed)
        for member in group:
            nearby = sorted(remaining.intersection(neighbors[member]))
            group.extend(nearby)
            remaining.difference_update(nearby)
        yield group


def grow_clusters(points, vectors):
    cells = [h3.latlng_to_cell(lat, lon, 4) for lon, lat, _ in points]
    buckets = defaultdict(list)
    for index, cell in enumerate(cells):
        buckets[cell].append(index)
    neighbor_distance = distance_squared(NEIGHBOR_KM, zones.EARTH_KM)
    radius = distance_squared(CLUSTER_KM, zones.EARTH_KM)
    neighbors = {}
    for cell, ids in buckets.items():
        nearby = np.asarray([i for adjacent in h3.grid_disk(cell, 3) for i in buckets.get(adjacent, ())], dtype=int)
        # Work one point at a time to keep dense-region allocations bounded.
        positions = vectors[nearby]
        for identifier in ids:
            distance = np.sum((positions - vectors[identifier]) ** 2, axis=1)
            neighbors[identifier] = set(nearby[distance <= neighbor_distance].tolist())
    unused = set(range(len(points)))
    for seed in range(len(points)):
        if seed not in unused or len(unused.intersection(neighbors[seed])) < MIN_POINTS:
            continue
        group = [seed]
        members = {seed}
        for member in group:
            candidates = sorted(unused.intersection(neighbors[member]) - members)
            if candidates:
                nearby = np.asarray(candidates, dtype=int)
                within = np.sum((vectors[nearby] - vectors[seed]) ** 2, axis=1) <= radius
                additions = nearby[within].tolist()
                group.extend(additions)
                members.update(additions)
        unused.difference_update(members)
        yield seed, sorted(group), neighbors


def local_frame(anchor, vector):
    lon, lat = np.radians(anchor[:2])
    east = np.array([-math.sin(lon), math.cos(lon), 0])
    north = np.array([-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)])
    return np.column_stack((east, north, vector))


def make_outline(points, pad):
    cloud = MultiPoint(points)
    outline = shapely.concave_hull(cloud, ratio=0.35)
    buffered = outline.buffer(pad, join_style="mitre", mitre_limit=1.5)
    simplified = buffered.simplify(0.8)
    return simplified if simplified.covers(cloud) else buffered


def to_geographic(outline, frame, longitude):
    def inverse(coords):
        x, y = (coords / zones.EARTH_KM).T
        vectors = np.column_stack((x, y, np.sqrt(np.maximum(0, 1 - x*x - y*y)))) @ frame.T
        lon = np.degrees(np.arctan2(vectors[:, 1], vectors[:, 0]))
        lon = longitude + (lon - longitude + 180) % 360 - 180
        lat = np.degrees(np.arcsin(vectors[:, 2].clip(-1, 1)))
        return np.column_stack((lon, lat))

    return zones.wrap_polygon(shapely.transform(outline, inverse).buffer(0))


def features_for(points, total_years):
    vectors = unit_vectors(points)
    for seed, members, neighbors in grow_clusters(points, vectors):
        frame = local_frame(points[seed], vectors[seed])
        positions = (vectors[members] @ frame)[:, :2] * zones.EARTH_KM
        coordinates = dict(zip(members, positions))
        cluster = f"modis-{seed}"
        parents = [(members, None)]
        for level, recurrence, pad in BANDS:
            children = []
            for members_at_level, parent in parents:
                eligible = [i for i in members_at_level if points[i, 2] >= math.ceil(total_years * recurrence)]
                for group in components(eligible, neighbors):
                    if len(group) < MIN_POINTS:
                        continue
                    outline = make_outline([coordinates[i] for i in group], pad)
                    if parent is not None:
                        outline = outline.intersection(parent)
                    geometry = to_geographic(outline, frame, points[seed, 0])
                    if geometry.is_empty:
                        continue
                    children.append((group, outline))
                    scores = points[group, 2]
                    yield {
                        "type": "Feature",
                        "geometry": mapping(shapely.orient_polygons(geometry) if hasattr(shapely, "orient_polygons") else geometry),
                        "properties": {
                            "cluster": cluster, "level": level, "hotspots": len(group),
                            "min_years": int(scores.min()), "max_years": int(scores.max()),
                        },
                    }
            parents = children


def build(release):
    start, end = data.RANGES["modis"]
    total_years = end.year - start.year + 1
    print(f"Scanning global MODIS archive {start} through {end}", flush=True)
    points = select_hotspots(release, start, end)
    print(f"Clustering {len(points):,} qualifying hotspot locations", flush=True)
    features = list(features_for(points, total_years))
    output = zones.index_path(release)
    output.parent.mkdir(parents=True, exist_ok=True)
    stream = NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False)
    temporary = Path(stream.name)
    try:
        with stream:
            json.dump({
                "type": "FeatureCollection", "method": zones.METHOD,
                "dataset_release": release.id, "dataset_manifest_sha256": release.digest,
                "sensor": "MODIS (Terra/Aqua)", "from": start.isoformat(), "to": end.isoformat(),
                "reference_years": total_years, "minimum_years": math.ceil(total_years * MIN_RECURRENCE),
                "candidate_fraction": MAX_CANDIDATE_FRACTION, "features": features,
            }, stream, separators=(",", ":"), allow_nan=False)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Wrote {len(features):,} polygons to {output}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, help="Verified release directory (defaults to FIRMS_DATA_ROOT)")
    args = parser.parse_args()
    build(data.open_release(args.release.resolve()) if args.release else data.active_release())
