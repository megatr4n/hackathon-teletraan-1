"""Read-only FIRMS observations from a verified portable release."""

import hashlib
import json
import os
from functools import lru_cache
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]


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
