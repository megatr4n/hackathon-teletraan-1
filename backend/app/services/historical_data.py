"""Read-only FIRMS observations from a verified portable release."""

import hashlib
import json
import os
import re
from datetime import date
from functools import lru_cache
from pathlib import Path

import shapely
import yaml


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
