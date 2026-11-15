"""Persist historical query metadata for workers on the same host."""

import json
import os
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile, gettempdir

from app.services.historical_data import DatasetUnavailable

QUERY_ID = re.compile(r"q_[0-9a-f]{32}")


def directory():
    return Path(os.getenv("FIRMS_QUERY_DIR") or Path(gettempdir()) / "teletraan-firms-queries")


@lru_cache(maxsize=8)
def prune(root, quarter_hour, cutoff):
    for path in root.glob("q_*.json"):
        if not QUERY_ID.fullmatch(path.stem):
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            continue


def save(query_id, request, digest, geometry_version, now, ttl):
    existing = load(query_id)
    if existing is not None and existing[-1] > now:
        return existing[-1]
    expires = now + ttl
    root = directory()
    temporary = None
    try:
        root.mkdir(parents=True, exist_ok=True)
        # Keep expired entries for one extra TTL so clients can still receive HTTP 410.
        quarter_hour = int(now.timestamp() // 900)
        prune(root, quarter_hour, quarter_hour * 900 - 2 * ttl.total_seconds())
        with NamedTemporaryFile(mode="w", dir=root, encoding="utf-8", delete=False) as output:
            temporary = Path(output.name)
            json.dump([request, digest, geometry_version, expires.isoformat()], output)
        # Readers see either the complete old entry or the complete new entry.
        temporary.replace(root / f"{query_id}.json")
        return expires
    except OSError as error:
        raise DatasetUnavailable("The historical query store is unavailable") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load(query_id):
    if not QUERY_ID.fullmatch(query_id):
        return None
    path = directory() / f"{query_id}.json"
    try:
        request, digest, geometry_version, expires = json.loads(path.read_text(encoding="utf-8"))
        return request, digest, geometry_version, datetime.fromisoformat(expires)
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError) as error:
        raise DatasetUnavailable("The historical query store is unavailable") from error
