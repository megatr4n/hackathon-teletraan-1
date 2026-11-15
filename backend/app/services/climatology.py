"""Seasonal FRP anomalies conditional on MODIS observations."""

import math
from collections import defaultdict
from datetime import date


WINDOW_DAYS = 7
MIN_REFERENCE_YEARS = 8
METHOD_ID = "modis-observed-frp-seasonal-v1"


def seasonal_index(day):
    # A leap reference year keeps March–December aligned on calendar date.
    return (date(2000, day.month, day.day) - date(2000, 1, 1)).days


def seasonal_scores(observed):
    by_day = defaultdict(list)
    for day, frp in observed.items():
        by_day[seasonal_index(day)].append((day.year, frp))

    windows = {}
    for target in {seasonal_index(day) for day in observed}:
        samples = []
        for offset in range(-WINDOW_DAYS, WINDOW_DAYS + 1):
            year_shift, index = divmod(target + offset, 366)
            samples.extend((year - year_shift, value) for year, value in by_day[index])
        windows[target] = samples
    result = {}
    for day, frp in observed.items():
        peers = [(year, value) for year, value in windows[seasonal_index(day)] if year != day.year]
        years = len({year for year, _ in peers})
        count = len(peers)
        score = None
        status = "insufficient_reference_years"
        if years >= MIN_REFERENCE_YEARS:
            mean = math.fsum(value for _, value in peers) / count
            deviation = math.sqrt(math.fsum((value - mean) ** 2 for _, value in peers) / (count - 1))
            status = "zero_reference_variance"
            if deviation > 0:
                score = (frp - mean) / deviation
                status = "available"
        result[day] = score_result(status, score, years, count)
    return result


def score_result(status, value=None, years=0, count=0):
    return {
        "z_score": value,
        "z_score_status": status,
        "z_score_reference_years": years,
        "z_score_reference_days": count,
    }
