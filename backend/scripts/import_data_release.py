"""Verify and install the published portable Parquet release."""

import argparse
import hashlib
import json
import tempfile
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


def install(archive: Path, output: Path) -> Path:
    trusted = json.loads(PUBLISHED_MANIFEST.read_bytes())
    release = trusted["release"]
    release_path = safe_path(release)
    if len(release_path.parts) != 1:
        raise ValueError("Invalid release identifier")
    target = output / release_path
    output.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError(f"Release already exists: {target}")

    with tempfile.TemporaryDirectory(prefix=".import-", dir=output) as temporary:
        staging = Path(temporary) / release
        staging.mkdir()
        with ZipFile(archive) as source:
            embedded = validate_archive(source, trusted)
            for entry in trusted["files"]:
                name = entry["path"]
                path = safe_path(name)
                member = source.getinfo(f"{release}/{name}")
                if member.file_size != entry["bytes"]:
                    raise ValueError(f"Unexpected size: {name}")
                digest = hashlib.sha256()
                destination = staging.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with source.open(member) as reader, destination.open("xb") as writer:
                    while chunk := reader.read(1024 * 1024):
                        digest.update(chunk)
                        writer.write(chunk)
                if digest.hexdigest() != entry["sha256"]:
                    raise ValueError(f"Checksum mismatch: {name}")
        (staging / "RELEASE.json").write_bytes(embedded)
        (staging / ".verified-release").write_text(hashlib.sha256(embedded).hexdigest())
        staging.rename(target)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(install(args.archive, args.output))
