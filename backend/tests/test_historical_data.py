"""Small canonical data fixture shared by reader regression checks."""

import os
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import duckdb

from app.services import historical_data as data


class LocalReleaseTest(unittest.TestCase):
    def setUp(self):
        repo = Path(self.enterContext(TemporaryDirectory()))
        manifest = Path("docs/data-release/RELEASE.json")
        trusted = (data.REPO / manifest).read_bytes()
        (repo / manifest).parent.mkdir(parents=True)
        (repo / manifest).write_bytes(trusted)
        self.release = repo / "Архів FIRMS" / "teletraan-data-v1"
        self.release.mkdir(parents=True)
        (self.release / "RELEASE.json").write_bytes(trusted)
        self.path_file = repo / "data-path.txt"
        self.enterContext(patch.object(data, "REPO", repo))
        self.enterContext(patch.object(data, "DATA_PATH_FILE", self.path_file))
        self.enterContext(patch.dict(os.environ, {"FIRMS_DATA_ROOT": ""}))
        self.addCleanup(data.open_release.cache_clear)

    def test_extracted_zip_requires_only_a_configured_folder(self):
        self.path_file.write_text('"Архів FIRMS/teletraan-data-v1"\n', encoding="utf-8-sig")
        release = data.active_release()
        self.assertEqual(release.id, "teletraan-data-v1")
        self.assertTrue(release.partitions)

    def test_path_to_parent_folder_reports_how_to_fix_it(self):
        self.path_file.write_text(str(self.release.parent), encoding="utf-8")
        with self.assertRaisesRegex(data.DatasetUnavailable, "containing RELEASE.json"):
            data.active_release()

    def test_env_override_still_requires_an_imported_release(self):
        self.path_file.write_text(str(self.release), encoding="utf-8")
        with patch.dict(os.environ, {"FIRMS_DATA_ROOT": str(self.release)}):
            with self.assertRaisesRegex(data.DatasetUnavailable, "verified by the importer"):
                data.active_release()


class HistoricalDataTest(unittest.TestCase):
    day = date(2012, 1, 20)
    cursor = ("", "", "")

    def setUp(self):
        scratch = Path(self.enterContext(TemporaryDirectory()))
        self.release = object.__new__(data.Release)
        self.release.partitions = {}
        with duckdb.connect() as db:
            observations = db.sql("""
                SELECT day::DATE AS obs_date, x::DOUBLE AS longitude, y::DOUBLE AS latitude,
                       satellite, sensor, daynight, frp::DOUBLE AS frp, invalid_frp_source
                FROM (VALUES
                    ('2012-01-20', 0.1, 0.1, 'T', 'modis', 'D', 10, NULL),
                    ('2012-01-20', 0.1, 0.1, 'T', 'modis', 'N', NULL, 'bad'),
                    ('2012-01-20', 0.2, 0.1, 'N', 'viirs-snpp', 'D', 7, NULL),
                    ('2012-01-20', 0.8, 0.8, 'T', 'modis', 'D', 99, NULL),
                    ('2012-01-21', -179.95, 0.0, 'A', 'modis', 'D', 25, NULL)
                ) rows(day, x, y, satellite, sensor, daynight, frp, invalid_frp_source)
            """)
            for sensor in ("modis", "viirs-snpp"):
                path = scratch / f"{sensor}.parquet"
                observations.filter(f"sensor = '{sensor}'").write_parquet(str(path))
                self.release.partitions[sensor, 2012, "observations"] = (path, path.stat().st_size)
        area = SimpleNamespace(kind="geometry", geometry={
            "type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 1], [0, 0]]],
        })
        self.selection = self.select(area)

    def select(self, area):
        polygon, bounds = data.geometry_for(area)
        request = SimpleNamespace(area=area, platforms=["terra", "aqua", "snpp"], orbit_pass="all")
        return SimpleNamespace(request=request, polygon=polygon, bounds=bounds)

    def test_area_uses_exact_polygon_and_preserves_invalid_frp_as_missing(self):
        with duckdb.connect() as db:
            query, args = data.records_sql(self.release, self.selection, self.day, self.day, db)
            rows = db.execute(query, args).fetchall()
        self.assertCountEqual([row[-3:] for row in rows], [
            ("terra", "day", 10.0), ("terra", "night", None), ("snpp", "day", 7.0),
        ])

    def test_daily_metrics_and_coverage_distinguish_missing_from_unobserved(self):
        rows = data.daily_records(self.release, self.selection, self.day, self.day)
        self.assertEqual(rows, [
            (self.day, "snpp", "day", 1, 1, 0, 7.0),
            (self.day, "terra", "day", 1, 1, 0, 10.0),
            (self.day, "terra", "night", 1, 0, 1, None),
        ])
        self.assertEqual(data.daily_records(self.release, self.selection, date(2012, 1, 22), date(2012, 1, 22)), [])
        self.assertEqual(data.coverage("terra", date(2012, 1, 22), False), "unknown_coverage")
        self.assertEqual(data.coverage("aqua", date(2002, 7, 3), False), "outside_observed_range")

    def test_antimeridian_circle_includes_the_other_side(self):
        circle = SimpleNamespace(kind="circle", center=(179.95, 0), radius_km=20)
        day = date(2012, 1, 21)
        rows = data.daily_records(self.release, self.select(circle), day, day)
        self.assertEqual(rows, [(day, "aqua", "day", 1, 1, 0, 25.0)])

    def test_h3_second_page_starts_after_the_cursor(self):
        first = data.cell_records(self.release, self.selection, self.day, 7, self.cursor, 1, sensor="modis")
        second = data.cell_records(self.release, self.selection, self.day, 7, first[0][:3], 1, sensor="modis")
        self.assertEqual(len(second), 1)
        self.assertLess(first[0][:3], second[0][:3])
        self.assertEqual([first[0][1], second[0][1]], ["terra", "terra"])

    def test_square_centers_are_in_bounds_and_detection_totals_match_h3(self):
        h3 = data.cell_records(self.release, self.selection, self.day, 7, self.cursor, 100)
        squares = data.cell_records(self.release, self.selection, self.day, 7, self.cursor, 100, size=3)
        self.assertEqual(sum(row[3] for row in h3), sum(row[3] for row in squares))
        for cell, *_ in squares:
            (lon, lat), (west, south, east, north) = data.square_center(cell, 3)
            self.assertTrue(west < lon < east and south < lat < north)
