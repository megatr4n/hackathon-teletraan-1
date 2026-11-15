"""Version 2 API for exact queries over canonical FIRMS observations."""


import duckdb
import h3
import hashlib
import json
import logging
import re
import shapely
from app.services import climatology
from app.services import historical_data as data
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, date, datetime
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from fastapi import Query
from functools import lru_cache
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.affinity import translate
from shapely.errors import GEOSException
from shapely.geometry import mapping
from threading import Lock
from typing import Annotated
from typing import Literal


router = APIRouter(prefix="/api/v2", tags=["FIRMS historical"])


log = logging.getLogger(__name__)


Platform = Literal["terra", "aqua", "snpp"]


CatalogKind = Literal["country", "admin", "eco", "preset"]


Sensor = Literal["modis", "viirs-snpp"]


MAX_DAYS = 9500


MIN_RESOLUTION = 2


MAX_RESOLUTION = 8


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


class ObservationScore(BaseModel):
    z_score: float | None
    z_score_status: Literal["available", "no_modis_frp", "insufficient_reference_years",
                            "zero_reference_variance", "not_requested"]
    z_score_reference_years: int
    z_score_reference_days: int


class CalendarDay(DailyObservation, ObservationScore):
    pass


class CalendarResponse(Provenance):
    days: list[CalendarDay]
    z_score_method: str


class DayResponse(Provenance, CalendarDay):
    platforms: list[PlatformDay]
    z_score_method: str


class Peak(BaseModel):
    date: date
    frp_sum_mw: float


class PlatformSummary(Counts):
    platform: Platform
    requested_days: int
    days_with_records: int
    days_with_confirmed_coverage: int | None
    days_with_valid_metric: int
    mean_observed_daily_frp_mw: float | None
    peak_frp: Peak | None


class SummaryResponse(Provenance):
    platforms_summary: list[PlatformSummary]


class CellObservation(Counts):
    cell_id: str
    date: date
    platform: Platform
    orbit_pass: Literal["day", "night", "unknown"] = Field(alias="pass")
    center: tuple[float, float]
    geometry: dict
    coverage_status: Literal["observed_records"]


class CellsResponse(Provenance):
    date: date
    resolution: int
    sensor: Sensor | None
    square_km: int | None
    cells: list[CellObservation]
    complete: bool
    next_cursor: str | None


class ReportResponse(Provenance):
    day: CalendarDay
    period: list[PlatformSummary]
    methodology: dict


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
            "acquisition_coverage": False, "calibration": False, "z_score": True,
            "forecast": False, "cells": True, "csv": False, "geojson": False,
        },
        "limits": {"max_days": MAX_DAYS, "query_ttl_seconds": TTL.total_seconds(), "h3_resolution": [2, 8]},
    }


@router.get("/methodology")
def methodology():
    return {
        "method_id": data.METHOD,
        "detection_count": "FIRMS detection records grouped by platform. Multiple platforms can observe the same fire.",
        "frp_sum_mw": "Sum of finite positive FRP readings in MW; null when none have valid FRP.",
        "coverage": "A detection confirms records for its platform and day. Missing records imply unknown coverage.",
        "geometry": "Exact point inclusion relative to the supplied geometry; catalog boundaries are simplified.",
        "cells": "H3 counts are by platform and pass. Cell boundaries can extend outside the selected area.",
        "climatology": {
            "method_id": climatology.METHOD_ID, "window_days_each_side": climatology.WINDOW_DAYS,
            "minimum_reference_years": climatology.MIN_REFERENCE_YEARS,
            "definition": "Raw daily MODIS FRP compared with observed MODIS days from other years "
                          "within the seasonal window, using sample standard deviation.",
            "reference_period": data.RANGES["modis"],
            "coverage": "Conditional on recorded FRP. Acquisition coverage is unavailable.",
        },
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


@lru_cache(maxsize=16)
def calendar_rows(selection):
    return range_rows(selection, selection.request.start, selection.request.end)


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


@lru_cache(maxsize=16)
def calendar_scores(selection):
    if not {"terra", "aqua"}.intersection(selection.request.platforms):
        return {}
    start, end = data.RANGES["modis"]
    if selection.request.start <= start and selection.request.end >= end:
        rows = calendar_rows(selection)
    else:
        rows = range_rows(selection, start, end)
    observed = {}
    for day, row in rows.items():
        values = [entry["frp_sum_mw"] for entry in row["platforms"]
                  if entry["platform"] in ("terra", "aqua") and entry["frp_sum_mw"] is not None]
        if values:
            observed[day] = sum(values)
    return climatology.seasonal_scores(observed)


def annotate_day(day, row, scores):
    if scores is None:
        result = climatology.score_result("not_requested")
    else:
        result = scores.get(day) or climatology.score_result("no_modis_frp")
    return {**row, **result}


@router.get("/queries/{query_id}/calendar", response_model=CalendarResponse)
def calendar(query_id: str, include_z_score: bool = True):
    selection = get_selection(query_id)
    rows = calendar_rows(selection)
    scores = calendar_scores(selection) if include_z_score else None
    return {**selection.metadata(), "z_score_method": climatology.METHOD_ID,
            "days": [annotate_day(day, row, scores) for day, row in rows.items()]}


@router.get("/queries/{query_id}/days/{day}", response_model=DayResponse)
def day_stats(query_id: str, day: date, include_z_score: bool = True):
    selection = get_selection(query_id, day)
    row = range_rows(selection, day, day)[day]
    scores = calendar_scores(selection) if include_z_score else None
    return {**selection.metadata(), "z_score_method": climatology.METHOD_ID,
            **annotate_day(day, row, scores)}


def summarize(selection, start=None, end=None):
    rows = [row for date, row in calendar_rows(selection).items()
            if (start is None or date >= start) and (end is None or date <= end)]
    summary = []
    for index, platform in enumerate(selection.request.platforms):
        values = [(row["date"], row["platforms"][index]) for row in rows]
        observed = [entry for _, entry in values if entry["detection_count"] is not None]
        valid = [(day, entry["frp_sum_mw"]) for day, entry in values if entry["frp_sum_mw"] is not None]
        total = sum(amount for _, amount in valid) if valid else None
        peak = max(valid, key=lambda pair: pair[1], default=None)
        summary.append({
            "platform": platform, "requested_days": len(rows), "days_with_records": len(observed),
            "days_with_confirmed_coverage": None, "days_with_valid_metric": len(valid),
            **metrics(sum(entry["detection_count"] for entry in observed) if observed else None,
                      sum(entry["valid_frp_count"] for entry in observed),
                      sum(entry["missing_frp_count"] for entry in observed), total),
            "mean_observed_daily_frp_mw": total / len(valid) if valid else None,
            "peak_frp": {"date": peak[0], "frp_sum_mw": peak[1]} if peak else None,
        })
    return summary


@router.get("/queries/{query_id}/summary", response_model=SummaryResponse)
def summary(query_id: str):
    selection = get_selection(query_id)
    return {**selection.metadata(), "platforms_summary": summarize(selection)}


@router.get("/queries/{query_id}/report-data", response_model=ReportResponse)
def report_data(query_id: str, date: date, start: date | None = None, end: date | None = None):
    selection = get_selection(query_id, date)
    if start:
        get_selection(query_id, start)
    if end:
        get_selection(query_id, end)
    if start and end and start > end:
        raise failure(422, "invalid_report_period", "The report start must precede its end")
    return {**selection.metadata(), "day": annotate_day(date, calendar_rows(selection)[date], calendar_scores(selection)),
            "period": summarize(selection, start, end), "methodology": methodology()}


def cell_shape(cell_id):
    lat, lon = h3.cell_to_latlng(cell_id)
    vertices = [(lon + ((x - lon + 180) % 360 - 180), y) for y, x in h3.cell_to_boundary(cell_id)]
    polygon = shapely.Polygon(vertices)
    if polygon.bounds[0] < -180:
        polygon = translate(polygon, xoff=360)
    if polygon.bounds[2] > 180:
        west = polygon.intersection(shapely.box(-180, -90, 180, 90))
        east = translate(polygon.intersection(shapely.box(180, -90, 360, 90)), xoff=-360)
        polygon = shapely.MultiPolygon([piece for piece in (west, east) if piece.geom_type == "Polygon" and not piece.is_empty])
    return [lon, lat], mapping(polygon)


def cell_rows(records, day, size=None):
    for cell_id, platform, orbit_pass, *values in records:
        if size is None:
            center, geometry = cell_shape(cell_id)
        else:
            center, bounds = data.square_center(cell_id, size)
            geometry = mapping(shapely.box(*bounds))
        yield {"cell_id": cell_id, "date": day.isoformat(), "platform": platform, "pass": orbit_pass,
               "center": center, "geometry": geometry, "coverage_status": "observed_records", **metrics(*values)}


def cursor_for(selection, day, resolution, sensor, record):
    return ":".join(map(str, [selection.identifier, day, resolution, sensor or "all", *record[:3]]))


@router.get("/queries/{query_id}/days/{day}/cells", response_model=CellsResponse)
def cells(query_id: str, day: date,
          resolution: int = Query(6, ge=MIN_RESOLUTION, le=MAX_RESOLUTION),
          cursor: str | None = Query(None, max_length=150), limit: int = Query(2000, ge=1, le=5000),
          sensor: Sensor | None = None, square_km: Literal["3", "9", "24"] | None = Query(None)):
    selection = get_selection(query_id, day)
    size = int(square_km) if square_km else None
    after = ("", "", "")
    layout = f"square{square_km}" if square_km else resolution
    if cursor:
        parts = cursor.split(":")
        if parts[:4] != [query_id, day.isoformat(), str(layout), sensor or "all"] or len(parts) != 7:
            raise failure(422, "invalid_cursor", "The cursor belongs to another cell selection")
        cell_key = parts[4]
        if square_km:
            valid = re.fullmatch(r"\d{1,5}_\d{1,5}", cell_key)
        else:
            valid = h3.is_valid_cell(cell_key) and h3.get_resolution(cell_key) == resolution
        if not valid:
            raise failure(422, "invalid_cursor", "The cursor contains an invalid cell")
        if parts[5] not in selection.request.platforms or parts[6] not in ("day", "night", "unknown"):
            raise failure(422, "invalid_cursor", "The cursor contains an invalid platform or pass")
        after = tuple(parts[4:])
    records = read_data(data.cell_records, selection.release, selection, day, resolution, after, limit + 1,
                        sensor, size)
    more = len(records) > limit
    return {**selection.metadata(), "date": day, "resolution": resolution, "sensor": sensor, "square_km": size,
            "cells": list(cell_rows(records[:limit], day, size)), "complete": not more,
            "next_cursor": cursor_for(selection, day, layout, sensor, records[limit - 1]) if more else None}
