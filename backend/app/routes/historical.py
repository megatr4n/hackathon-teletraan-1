"""Version 2 API for exact queries over canonical FIRMS observations."""


import duckdb
import hashlib
import json
import logging
from app.services import historical_data as data
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, date, datetime
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from fastapi import Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.errors import GEOSException
from threading import Lock
from typing import Annotated
from typing import Literal


router = APIRouter(prefix="/api/v2", tags=["FIRMS historical"])


log = logging.getLogger(__name__)


Platform = Literal["terra", "aqua", "snpp"]


CatalogKind = Literal["country", "admin", "eco", "preset"]


MAX_DAYS = 9500


TTL = timedelta(hours=2)


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Circle(Input):
    kind: Literal["circle"]
    center: tuple[Annotated[float, Field(ge=-180, le=180)], Annotated[float, Field(ge=-90, le=90)]]
    radius_km: Annotated[float, Field(gt=0, le=20_016)]


class Geometry(Input):
    kind: Literal["geometry"]
    geometry: dict


class CatalogArea(Input):
    kind: CatalogKind
    id: Annotated[str, Field(min_length=1, max_length=100)]
    parent_id: Annotated[str | None, Field(max_length=3)] = None


class SelectionRequest(Input):
    area: Annotated[Circle | Geometry | CatalogArea, Field(discriminator="kind")]
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    orbit_pass: Literal["all", "day", "night"] = Field("all", alias="pass")
    platforms: list[Platform] = Field(default_factory=lambda: ["terra", "aqua", "snpp"], min_length=1, max_length=3)
    quality_policy: Literal["canonical"] = "canonical"
    spatial_mode: Literal["exact"] = "exact"
    calibration: Literal["none"] = "none"
    dataset_release: str | None = None

    @model_validator(mode="after")
    def normalize(self):
        if not 0 <= (self.end - self.start).days < MAX_DAYS:
            raise ValueError(f"Expected an inclusive date span of 1 to {MAX_DAYS} days")
        self.platforms = sorted(set(self.platforms))
        return self


class Provenance(BaseModel):
    query_id: str
    dataset_release: str
    dataset_manifest_sha256: str
    geometry_version: str
    source: Literal["firms"]
    quality_policy: Literal["canonical"]
    spatial_mode: Literal["exact"]
    method_id: str
    calibration: dict[str, str]
    platforms: list[Platform]
    orbit_pass: Literal["all", "day", "night"] = Field(alias="pass")
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    expires_at: datetime


class Counts(BaseModel):
    detection_count: int | None
    valid_frp_count: int
    missing_frp_count: int
    frp_sum_mw: float | None


class PlatformDay(Counts):
    platform: Platform
    coverage_status: Literal["observed_records", "unknown_coverage", "outside_observed_range"]
    by_pass: dict[Literal["day", "night", "unknown"], Counts]


class DailyObservation(BaseModel):
    date: date
    platforms: list[PlatformDay]


class DayResponse(Provenance, DailyObservation):
    platforms: list[PlatformDay]


@dataclass(eq=False)
class Selection:
    request: SelectionRequest
    release: data.Release
    polygon: object
    bounds: tuple
    expires: datetime
    identifier: str

    def metadata(self):
        return {
            "query_id": self.identifier, "dataset_release": self.release.id,
            "dataset_manifest_sha256": self.release.digest, "geometry_version": data.GEO_VERSION,
            "source": "firms", "quality_policy": self.request.quality_policy,
            "spatial_mode": self.request.spatial_mode, "method_id": data.METHOD,
            "calibration": {"id": "none", "status": "disabled"},
            "platforms": self.request.platforms, "pass": self.request.orbit_pass,
            "from": self.request.start, "to": self.request.end, "expires_at": self.expires,
        }


selections: OrderedDict[str, Selection] = OrderedDict()


selection_lock = Lock()


def failure(status, code, message):
    return HTTPException(status, {"code": code, "message": message})


def get_release():
    try:
        return data.active_release()
    except data.DatasetUnavailable as error:
        raise failure(503, "dataset_unavailable", str(error)) from error


def read_data(operation, *args):
    try:
        return operation(*args)
    except data.DatasetUnavailable as error:
        raise failure(503, "dataset_unavailable", str(error)) from error
    except duckdb.Error as error:
        log.exception("Historical query could not read the verified release")
        raise failure(503, "query_failed", "The historical query could not be completed") from error


@router.get("/datasets/active")
def dataset():
    release = get_release()
    return {
        "dataset_release": release.id, "dataset_manifest_sha256": release.digest,
        "geometry_version": data.GEO_VERSION, "observed_ranges": data.RANGES,
        "platform_observed_ranges": data.PLATFORM_RANGES,
        "canonical_records": release.manifest["canonical_records"],
        "quality_policies": ["canonical"], "spatial_modes": ["exact"],
        "capabilities": {
            "acquisition_coverage": False, "calibration": False, "z_score": False,
            "forecast": False, "cells": False, "csv": False, "geojson": False,
        },
        "limits": {"max_days": MAX_DAYS, "query_ttl_seconds": TTL.total_seconds()},
    }


@router.get("/methodology")
def methodology():
    return {
        "method_id": data.METHOD,
        "detection_count": "FIRMS detection records grouped by platform. Multiple platforms can observe the same fire.",
        "frp_sum_mw": "Sum of finite positive FRP readings in MW; null when none have valid FRP.",
        "coverage": "A detection confirms records for its platform and day. Missing records imply unknown coverage.",
        "geometry": "Exact point inclusion relative to the supplied geometry; catalog boundaries are simplified.",
        "fire_radiative_energy": None, "emissions": None,
    }


@router.get("/geographies")
def geographies(kind: CatalogKind, q: str = Query("", max_length=120),
                parent_id: str | None = None, cursor: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
    items = sorted(
        (item for item in data.catalog_items(kind, parent_id)
         if q.casefold() in f'{item["name"]} {item["id"]}'.casefold()),
        key=lambda item: (item["name"].casefold(), str(item["id"])),
    )
    return {
        "items": items[cursor:cursor + limit], "geometry_version": data.GEO_VERSION,
        "next_cursor": cursor + limit if cursor + limit < len(items) else None,
    }


@router.get("/geographies/{kind}/{identifier}")
def geography(kind: CatalogKind, identifier: str, parent_id: str | None = None):
    try:
        return {"feature": data.catalog_feature(kind, identifier, parent_id), "geometry_version": data.GEO_VERSION}
    except LookupError as error:
        raise failure(404, "unknown_territory", str(error)) from error


@router.get("/presets")
def presets():
    return {"items": data.presets(), "geometry_version": data.GEO_VERSION}


@router.post("/queries", response_model=Provenance)
def create_query(request: SelectionRequest):
    release = get_release()
    if request.dataset_release and request.dataset_release != release.id:
        raise failure(404, "unknown_release", "The requested release is unavailable")
    request.dataset_release = release.id
    serialized = json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    key = "q_" + hashlib.sha256((release.digest + data.GEO_VERSION + serialized).encode()).hexdigest()[:32]
    now = datetime.now(UTC)
    with selection_lock:
        existing = selections.get(key)
        if existing and existing.expires > now:
            return existing.metadata()
    try:
        polygon, bounds = data.geometry_for(request.area)
    except LookupError as error:
        raise failure(404, "unknown_territory", str(error)) from error
    except (ValueError, TypeError, KeyError, IndexError, GEOSException) as error:
        raise failure(422, "invalid_geometry", str(error)) from error
    selection = Selection(request, release, polygon, bounds, now + TTL, key)
    with selection_lock:
        selections[key] = selection
        selections.move_to_end(key)
        while len(selections) > 128:
            selections.popitem(last=False)
    return selection.metadata()


def get_selection(query_id, day=None):
    with selection_lock:
        selection = selections.get(query_id)
    if selection is None:
        raise failure(404, "unknown_query", "Create the selection again")
    if selection.expires <= datetime.now(UTC):
        raise failure(410, "expired_query", "Create the selection again")
    if day and not selection.request.start <= day <= selection.request.end:
        raise failure(422, "date_out_of_bounds", "The day is outside the query interval")
    return selection


def metrics(detections=0, valid=0, missing=0, frp=None):
    return {
        "detection_count": detections, "valid_frp_count": valid,
        "missing_frp_count": missing, "frp_sum_mw": frp,
    }


def scan_daily(selection, start, end):
    # Release the DuckDB scan lock between blocks so day and map requests can run.
    while start <= end:
        block_end = min(end, date(min(start.year + 2, 9999), 12, 31))
        yield from read_data(data.daily_records, selection.release, selection, start, block_end)
        if block_end == end:
            break
        start = block_end + timedelta(days=1)


def range_rows(selection, start, end):
    request = selection.request
    groups = {}
    for day, platform, orbit_pass, *values in scan_daily(selection, start, end):
        groups.setdefault((day, platform), {})[orbit_pass] = metrics(*values)
    rows = {}
    for day in data.date_rows(start, end):
        entries = []
        for platform in request.platforms:
            passes = groups.get((day, platform), {})
            status = data.coverage(platform, day, bool(passes))
            recorded = list(passes.values())
            frp = [value["frp_sum_mw"] for value in recorded if value["frp_sum_mw"] is not None]
            totals = metrics(*(sum(row[field] for row in recorded) for field in
                               ("detection_count", "valid_frp_count", "missing_frp_count")),
                             sum(frp) if frp else None)
            if not passes:
                totals["detection_count"] = None
            entries.append({"platform": platform, "coverage_status": status, "by_pass": passes, **totals})
        rows[day] = {"date": day.isoformat(), "platforms": entries}
    return rows


@router.get("/queries/{query_id}/days/{day}", response_model=DayResponse)
def day_stats(query_id: str, day: date):
    selection = get_selection(query_id, day)
    row = range_rows(selection, day, day)[day]
    return {**selection.metadata(), **row}
