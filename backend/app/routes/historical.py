"""Version 2 API for exact queries over canonical FIRMS observations."""


from app.services import historical_data as data
from datetime import timedelta
from fastapi import APIRouter, HTTPException


router = APIRouter(prefix="/api/v2", tags=["FIRMS historical"])


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
        "observed_ranges": data.RANGES,
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
        "method_id": "firms-canonical-v1",
        "detection_count": "FIRMS detection records grouped by platform. Multiple platforms can observe the same fire.",
        "frp_sum_mw": "Sum of finite positive FRP readings in MW; null when none have valid FRP.",
        "coverage": "A detection confirms records for its platform and day. Missing records imply unknown coverage.",
        "geometry": "Exact point inclusion relative to the supplied geometry; catalog boundaries are simplified.",
        "fire_radiative_energy": None, "emissions": None,
    }
