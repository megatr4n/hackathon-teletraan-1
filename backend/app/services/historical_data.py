"""Read-only FIRMS observations from a verified portable release."""

import hashlib
import json
import os
import re
from datetime import date
from functools import lru_cache
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]


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
