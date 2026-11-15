"""HTTP report contract against the small real Parquet reader fixture."""
from datetime import date
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.routes import historical as api
import unittest
import test_historical_data as fixtures

class ReportDataTest(unittest.TestCase):
    select=fixtures.HistoricalDataTest.select
    def setUp(self):
        fixtures.HistoricalDataTest.setUp(self)
        self.selection.release=self.release
        self.selection.request.start=date(2012,1,19)
        self.selection.request.end=date(2012,1,22)
        self.selection.request.area=api.Geometry(kind='geometry',geometry={
            'type':'Polygon','coordinates':[[[0,0],[1,0],[0,1],[0,0]]]})
        metadata=dict(query_id='q_'+'a'*32,dataset_release='fixture',dataset_manifest_sha256='b'*64,
            geometry_version='fixture',source='firms',quality_policy='canonical',spatial_mode='exact',
            method_id='fixture',calibration={'id':'none'},platforms=['terra','aqua','snpp'],
            **{'pass':'all','from':'2012-01-19','to':'2012-01-22','expires_at':'2030-01-01T00:00:00Z'})
        self.selection.metadata=lambda:metadata
        def selection(query_id,day=None):
            if day and not self.selection.request.start<=day<=self.selection.request.end:
                raise api.failure(422,'date_out_of_bounds','Date outside query')
            return self.selection
        self.enterContext(patch.object(api,'get_selection',selection))
        self.enterContext(patch.object(api,'calendar_rows',lambda s:api.range_rows(s,s.request.start,s.request.end)))
        self.enterContext(patch.object(api,'calendar_scores',lambda s:{}))
        self.client=TestClient(app)

    def test_report_daily_series_and_summary_share_period(self):
        r=self.client.get('/api/v2/queries/q_fixture/report-data',params={
            'date':'2012-01-20','start':'2012-01-20','end':'2012-01-21'})
        self.assertEqual(r.status_code,200,r.text)
        body=r.json()
        self.assertEqual([d['date'] for d in body['series']],['2012-01-20','2012-01-21'])
        self.assertEqual(body['area']['kind'],'geometry')
        terra=next(p for p in body['period'] if p['platform']=='terra')
        self.assertEqual(terra['detection_count'],2)
        self.assertEqual(terra['frp_sum_mw'],10)
        self.assertEqual(terra['missing_frp_count'],1)
        self.assertEqual(terra['days_with_records'],1)
        self.assertEqual(terra['requested_days'],2)
        day2=body['series'][1]
        self.assertTrue(all(p['detection_count'] is None for p in day2['platforms']))

    def test_default_period_and_selected_day_outside_subperiod(self):
        result=self.client.get('/api/v2/queries/q_fixture/report-data',params={'date':'2012-01-20'}).json()
        self.assertEqual(len(result['series']),4)
        self.assertEqual(result['report_start'],'2012-01-19')
        self.assertEqual(result['report_end'],'2012-01-22')
        r=self.client.get('/api/v2/queries/q_fixture/report-data',params={
            'date':'2012-01-20','start':'2012-01-21','end':'2012-01-22'})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['day']['date'],'2012-01-20')
        self.assertEqual(r.json()['series'][0]['date'],'2012-01-21')

    def test_reversed_and_out_of_bounds_periods_fail(self):
        for start,end in [('2012-01-22','2012-01-20'),('2012-01-18','2012-01-22')]:
            r=self.client.get('/api/v2/queries/q_fixture/report-data',params={'date':'2012-01-20','start':start,'end':end})
            self.assertEqual(r.status_code,422,r.text)
