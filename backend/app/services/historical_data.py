"""Read-only FIRMS observations from a verified portable release."""

import hashlib
import json
import math
import os
import re
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from threading import Lock, local

import duckdb
import h3
import shapely
import yaml
from shapely.geometry import shape


REPO = Path(__file__).resolve().parents[3]
GEOGRAPHY = REPO / "frontend/public/geography"
GEO_VERSION = "firms-geography-v1"
METHOD = "firms-canonical-v1"


RANGES = {
    "modis": (date(2000, 11, 1), date(2025, 12, 31)),
    "viirs-snpp": (date(2012, 1, 20), date(2025, 12, 31)),
}
SENSOR = {"terra": "modis", "aqua": "modis", "snpp": "viirs-snpp"}
PARTITION = re.compile(
    r"artifacts/global/observations/sensor=([^/]+)/year=(\d{4})/(observations|sensor_daily)\.parquet"
)
PLATFORM_RANGES = {platform: RANGES[sensor] for platform, sensor in SENSOR.items()}
PLATFORM_RANGES["aqua"] = (date(2002, 7, 4), RANGES["modis"][1])


class DatasetUnavailable(Exception):
    pass


class Release:
    def __init__(self, root: Path):
        manifest_bytes = (root / "RELEASE.json").read_bytes()
        self.digest = hashlib.sha256(manifest_bytes).hexdigest()
        if (root / ".verified-release").read_text().strip() != self.digest:
            raise DatasetUnavailable("Release has not been verified by the importer")
        self.manifest = json.loads(manifest_bytes)
        trusted = json.loads((REPO / "docs/data-release/RELEASE.json").read_bytes())
        if self.manifest != trusted:
            raise DatasetUnavailable("Manifest differs from the published release")
        self.id = self.manifest["release"]
        self.partitions = {}
        for entry in self.manifest["files"]:
            match = PARTITION.fullmatch(entry["path"])
            if match:
                sensor, year, table = match.groups()
                self.partitions[sensor, int(year), table] = (root / entry["path"], entry["bytes"])

    def paths(self, platforms, start, end, table):
        paths = []
        years = set()
        for platform in platforms:
            first, last = PLATFORM_RANGES[platform]
            begin, finish = max(first, start), min(last, end)
            if begin <= finish:
                years.update((SENSOR[platform], year) for year in range(begin.year, finish.year + 1))
        for sensor, year in sorted(years):
            partition = self.partitions.get((sensor, year, table))
            if not partition:
                raise DatasetUnavailable(f"Partition not listed: {sensor}/{year}/{table}")
            path, size = partition
            if not path.is_file() or path.stat().st_size != size:
                raise DatasetUnavailable(f"Partition missing or damaged: {sensor}/{year}/{table}")
            paths.append(path.as_posix())
        return paths


@lru_cache(maxsize=4)
def open_release(root):
    try:
        return Release(root)
    except (OSError, ValueError, KeyError) as error:
        raise DatasetUnavailable("A verified portable release is required") from error


def active_release():
    root = os.getenv("FIRMS_DATA_ROOT")
    if not root:
        raise DatasetUnavailable("Set FIRMS_DATA_ROOT to an imported release directory")
    return open_release(Path(root).resolve())


@lru_cache(maxsize=64)
def geography_file(name):
    return json.loads((GEOGRAPHY / f"{name}.json").read_bytes())


@lru_cache(maxsize=1)
def presets():
    return yaml.safe_load((REPO / "config/regions.yaml").read_text(encoding="utf-8"))["regions"]


def catalog_feature(kind, identifier, parent=None):
    if kind == "preset":
        item = next((item for item in presets() if item["id"] == identifier), None)
        if item:
            return {"type": "Feature", "properties": item, "geometry": shapely.geometry.mapping(
                shapely.box(*item["bbox"])
            )}
    if kind == "admin" and parent and re.fullmatch(r"[A-Z0-9]{3}", parent):
        name = f"admin/{parent}"
    else:
        name = {"country": "countries", "eco": "ecoregions"}.get(kind)
    if name:
        try:
            return next(
                feature for feature in geography_file(name)["features"]
                if str(feature["properties"]["id"]) == identifier
            )
        except (StopIteration, FileNotFoundError):
            pass
    raise LookupError("Unknown territory")


def catalog_items(kind, parent):
    if kind == "preset":
        return [{"id": item["id"], "name": item["name_en"]} for item in presets()]
    if kind == "admin":
        if not parent or not re.fullmatch(r"[A-Z0-9]{3}", parent):
            return []
        name = f"admin/{parent}"
    else:
        name = {"country": "countries", "eco": "ecoregions"}[kind]
    try:
        return [feature["properties"] for feature in geography_file(name)["features"]]
    except FileNotFoundError:
        return []


def geometry_for(area):
    if area.kind == "circle":
        longitude, latitude = area.center
        angle = area.radius_km / 6371.0088
        latitude_radians = math.radians(latitude)
        delta_latitude = math.degrees(angle)
        south, north = max(-90, latitude - delta_latitude), min(90, latitude + delta_latitude)
        if south == -90 or north == 90:
            return None, (-180, south, 180, north)
        delta_longitude = math.degrees(math.asin(math.sin(angle) / math.cos(latitude_radians)))
        west, east = longitude - delta_longitude, longitude + delta_longitude
        if west < -180 or east > 180:
            west, east = -180, 180
        return None, (west, south, east, north)

    raw = area.geometry if area.kind == "geometry" else catalog_feature(
        area.kind, area.id, area.parent_id
    )["geometry"]
    if raw.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Expected a Polygon or MultiPolygon")
    polygon = shape(raw)
    if area.kind != "geometry" and not shapely.is_valid(polygon):
        # Repair overlaps and self-intersections in the simplified catalog boundaries.
        polygon = polygon.buffer(0)
    if polygon.is_empty or shapely.has_z(polygon) or not shapely.is_valid(polygon):
        raise ValueError("Invalid WGS84 polygon")
    vertices = shapely.get_coordinates(polygon)
    if len(vertices) > 30_000 or not (
        ((vertices[:, 0] >= -180) & (vertices[:, 0] <= 180))
        & ((vertices[:, 1] >= -90) & (vertices[:, 1] <= 90))
    ).all():
        raise ValueError("Geometry exceeds WGS84 bounds or the vertex limit")
    if area.kind == "geometry":
        for part in shapely.get_parts(polygon):
            for ring in [part.exterior, *part.interiors]:
                if any(abs(a[0] - b[0]) > 180 for a, b in zip(ring.coords, ring.coords[1:])):
                    raise ValueError("Split polygons crossing the antimeridian into a MultiPolygon")
    shapely.prepare(polygon)
    return polygon, polygon.bounds


PASSES = {"day": "D", "night": "N"}


def records_sql(release, selection, start, end, db, sensor=None):
    request = selection.request
    requested = [platform for platform in request.platforms if sensor is None or SENSOR[platform] == sensor]
    paths = release.paths(requested, start, end, "observations")
    if not paths:
        return None, []
    west, south, east, north = selection.bounds
    filters = [
        "obs_date BETWEEN ? AND ?", "longitude BETWEEN ? AND ?", "latitude BETWEEN ? AND ?"
    ]
    args = [paths, start, end, west, east, south, north]
    if request.area.kind == "circle":
        longitude, latitude = request.area.center
        filters.append("""
            pow(sin(radians(latitude - ?) / 2), 2)
            + cos(radians(latitude)) * cos(radians(?))
              * pow(sin(radians(longitude - ?) / 2), 2) <= ?
        """)
        args.extend([latitude, latitude, longitude, math.sin(request.area.radius_km / 6371.0088 / 2) ** 2])
    else:
        geometry = shapely.to_wkb(selection.polygon)
        worker = local()

        def in_area(x, y):
            # DuckDB may execute Arrow batches on different threads.
            if not hasattr(worker, "polygon"):
                worker.polygon = shapely.from_wkb(geometry)
                shapely.prepare(worker.polygon)
            return shapely.intersects_xy(worker.polygon, x.to_numpy(), y.to_numpy())

        db.create_function("in_area", in_area, ["DOUBLE", "DOUBLE"], "BOOLEAN", type="arrow")
        filters.append("in_area(longitude, latitude)")
    if request.orbit_pass != "all":
        filters.append("upper(daynight) = ?")
        args.append(PASSES[request.orbit_pass])

    platforms = ", ".join("?" for _ in requested)
    args.extend(requested)
    return f"""
        WITH points AS (
            SELECT obs_date, longitude, latitude,
                CASE
                    WHEN sensor = 'viirs-snpp' THEN 'snpp'
                    WHEN lower(trim(satellite)) IN ('terra', 't') THEN 'terra'
                    WHEN lower(trim(satellite)) IN ('aqua', 'a') THEN 'aqua'
                END AS platform,
                CASE upper(daynight) WHEN 'D' THEN 'day' WHEN 'N' THEN 'night' ELSE 'unknown' END AS pass,
                CASE WHEN isfinite(frp) AND frp > 0 AND invalid_frp_source IS NULL THEN frp END AS valid_frp
            FROM read_parquet(?, hive_partitioning=true)
            WHERE {" AND ".join(filters)}
        )
        SELECT * FROM points WHERE platform IN ({platforms})
    """, args


METRICS = """
    count(*) AS detection_count,
    count(valid_frp) AS valid_frp_count,
    count(*) - count(valid_frp) AS missing_frp_count,
    sum(valid_frp) AS frp_sum_mw
"""
SCAN_LOCK = Lock()
DUCKDB_OPTIONS = {"threads": 4}


def date_rows(start, end):
    for offset in range((end - start).days + 1):
        yield start + timedelta(days=offset)


def coverage(platform, day, has_records):
    start, end = PLATFORM_RANGES[platform]
    if not start <= day <= end:
        return "outside_observed_range"
    return "observed_records" if has_records else "unknown_coverage"


def daily_records(release, selection, start, end):
    with SCAN_LOCK, duckdb.connect(config=DUCKDB_OPTIONS) as db:
        db.execute("SET enable_progress_bar = false")
        source, args = records_sql(release, selection, start, end, db)
        if not source:
            return []
        return db.execute(f"""
            SELECT obs_date, platform, pass, {METRICS}
            FROM ({source}) GROUP BY ALL ORDER BY ALL
        """, args).fetchall()


def square_center(cell_id, size):
    row, column = map(int, cell_id.split("_"))
    latitude = min(90, (row + 1) * size / 111.195 - 90)
    latitude = (latitude + row * size / 111.195 - 90) / 2
    width = size / (111.195 * math.cos(math.radians(latitude)))
    west = -180 + column * width
    longitude = (west + min(180, west + width)) / 2
    return [longitude, latitude], (west, row * size / 111.195 - 90,
                                  min(180, west + width), min(90, (row + 1) * size / 111.195 - 90))


def cell_records(release, selection, day, resolution, cursor, limit, sensor=None, size=None):
    with SCAN_LOCK, duckdb.connect(config=DUCKDB_OPTIONS) as db:
        db.execute("SET enable_progress_bar = false")
        source, args = records_sql(release, selection, day, day, db, sensor=sensor)
        if not source:
            return []
        def cell_id(latitude: float, longitude: float) -> str:
            return h3.latlng_to_cell(latitude, longitude, resolution)

        if size is None:
            db.create_function("h3_cell", cell_id)
            cell_expression = "h3_cell(latitude, longitude)"
        else:
            row = f"floor((least(latitude, 89.9999999) + 90) * 111.195 / {size})"
            midpoint = f"(({row} * {size} / 111.195 - 90 + least(90, ({row} + 1) * {size} / 111.195 - 90)) / 2)"
            column = f"floor((least(longitude, 179.9999999) + 180) * 111.195 * cos(radians({midpoint})) / {size})"
            cell_expression = f"concat(({row})::BIGINT, '_', ({column})::BIGINT)"
        return db.execute(f"""
            WITH indexed AS (
                SELECT {cell_expression} AS cell_id, platform, pass, valid_frp
                FROM ({source})
            )
            SELECT cell_id, platform, pass, {METRICS}
            FROM indexed WHERE (cell_id, platform, pass) > (?, ?, ?)
            GROUP BY ALL ORDER BY cell_id, platform, pass LIMIT ?
        """, args + [*cursor, limit]).fetchall()
