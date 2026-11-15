"""Version 2 API for exact queries over canonical FIRMS observations."""


from app.services import historical_data as data
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from fastapi import Query
from typing import Literal


router = APIRouter(prefix="/api/v2", tags=["FIRMS historical"])


CatalogKind = Literal["country", "admin", "eco", "preset"]


MAX_DAYS = 9500


TTL = timedelta(hours=2)


def failure(status, code, message):
    return HTTPException(status, {"code": code, "message": message})


def get_release():
    try:
        return data.active_release()
    except data.DatasetUnavailable as error:
        raise failure(503, "dataset_unavailable", str(error)) from error


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
