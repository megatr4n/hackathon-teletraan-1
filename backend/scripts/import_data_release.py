"""Verify and install the published portable Parquet release."""

import json
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


REPO = Path(__file__).resolve().parents[2]
PUBLISHED_MANIFEST = REPO / "docs/data-release/RELEASE.json"


def safe_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (
        path.is_absolute() or not path.parts or ".." in path.parts
        or "\\" in name or ":" in name or path.as_posix() != name
    ):
        raise ValueError(f"Unsafe archive path: {name}")
    return path


def validate_archive(source: ZipFile, trusted: dict) -> bytes:
    release = trusted["release"]
    if len(safe_path(release).parts) != 1:
        raise ValueError("Invalid release identifier")
    names = source.namelist()
    if len(names) != len(set(names)):
        raise ValueError("Portable archive contains duplicate paths")
    for name in names:
        path = safe_path(name.removesuffix("/"))
        if path.parts[0] != release:
            raise ValueError(f"Unexpected archive root: {name}")
    embedded = source.read(f"{release}/RELEASE.json")
    if json.loads(embedded) != trusted:
        raise ValueError("Archive manifest differs from the published manifest")
    paths = [entry["path"] for entry in trusted["files"]]
    if len(paths) != len(set(paths)):
        raise ValueError("Portable manifest contains duplicate paths")
    for name in paths:
        safe_path(name)
        source.getinfo(f"{release}/{name}")
    return embedded
