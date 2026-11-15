import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {readFile} from 'node:fs/promises'
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'})
try{
  const {dailySeries,countBins,pairedCounts,validateReport,reportEvidence}=await vite.ssrLoadModule('/src/report/analysis.ts')
  const {calibration}=await vite.ssrLoadModule('/src/calibration.ts')
  const {actualDay,historicalCalendarValue,historicalCells}=await vite.ssrLoadModule('/src/historical.ts')
  function fixture(start,n){
    const empty={detection_count:null,valid_frp_count:0,missing_frp_count:0,frp_sum_mw:null}
    const series=Array.from({length:n},(_,i)=>({date:new Date(Date.parse(start)+86400000*i).toISOString().slice(0,10),
      z_score:null,z_score_status:'insufficient_reference_years',z_score_reference_days:0,z_score_reference_years:0,
      platforms:['terra','aqua','snpp'].map(platform=>({platform,coverage_status:'unknown_coverage',by_pass:{},...empty}))}))
    const report={source:'firms',query_id:'q_fixture',dataset_manifest_sha256:'a'.repeat(64),pass:'all',
      area_bounds:[0,0,1,1],report_start:start,report_end:series.at(-1).date,platforms:['terra','aqua','snpp'],series,day:series[0],period:[]}
    return report
  }
  function record(report,index,platform,count,frp=count){
    Object.assign(report.series[index].platforms.find(p=>p.platform===platform),{
      detection_count:count,frp_sum_mw:frp,valid_frp_count:frp===null?0:count,missing_frp_count:frp===null?count:0,coverage_status:'observed_records'})
  }
  function summarize(r){
    r.period=r.platforms.map(platform=>{
      const days=r.series.map(d=>d.platforms.find(p=>p.platform===platform)),valid=days.filter(d=>d.frp_sum_mw!==null),counts=days.filter(d=>d.detection_count!==null)
      return {platform,requested_days:days.length,days_with_records:counts.length,days_with_valid_metric:valid.length,
        detection_count:counts.length?counts.reduce((n,d)=>n+d.detection_count,0):null,
        frp_sum_mw:valid.length?valid.reduce((n,d)=>n+d.frp_sum_mw,0):null,
        mean_observed_daily_frp_mw:valid.length?valid.reduce((n,d)=>n+d.frp_sum_mw,0)/valid.length:null,
        peak_frp:valid.length?{date:r.series.find(d=>d.platforms.find(p=>p.platform===platform).frp_sum_mw===Math.max(...valid.map(d=>d.frp_sum_mw))).date,frp_sum_mw:Math.max(...valid.map(d=>d.frp_sum_mw))}:null,
        valid_frp_count:days.reduce((n,d)=>n+d.valid_frp_count,0),missing_frp_count:days.reduce((n,d)=>n+d.missing_frp_count,0)}
    }); return r
  }
  const r=fixture('2012-01-19',4)
  record(r,0,'terra',2);record(r,0,'snpp',99) // even a malformed pre-launch input cannot create a VIIRS chart value
  record(r,1,'terra',2);record(r,1,'aqua',3);record(r,1,'snpp',20)
  record(r,2,'aqua',4,null) // Raw MODIS still counts detections without FRP.
  record(r,3,'terra',7);record(r,3,'snpp',10) // Terra alone cannot enter the Aqua comparison.
  summarize(r)
  const rows=dailySeries(r)
  assert.equal(rows[0].viirs,null);assert.equal(rows[0].adjusted,null)
  assert.equal(rows[1].raw,3);assert.equal(rows[1].adjusted,3*calibration.hotspots.all);assert.equal(rows[1].viirs,20)
  assert.equal(rows[2].raw,4);assert.equal(rows[2].viirs,null);assert.equal(rows[3].raw,null);assert.equal(rows[3].adjusted,null)
  for(const pass of ['all','day','night'])assert.equal(dailySeries({...r,pass})[1].adjusted,3*calibration.hotspots[pass])
  const pair=pairedCounts(rows)
  assert.equal(pair.n,1);assert.equal(pair.rawAqua.mae,17);assert.equal(pair.rawAqua.meanDifference,-17);assert.equal(pair.rawAqua.wape,85)
  assert.equal(pairedCounts([]).rawAqua.wape,null)
  assert.equal(pairedCounts([{date:'2020-01-01',raw:1,aqua:1,adjusted:2,adjustedPlatform:'aqua',viirs:0}]).rawAqua.wape,null)
  validateReport(r,r.report_start,r.report_end,r.query_id)
  const wrongMean=structuredClone(r);wrongMean.period[0].mean_observed_daily_frp_mw=999
  assert.throws(()=>validateReport(wrongMean,r.report_start,r.report_end),/mean disagrees/)
  const wrongPeak=structuredClone(r);wrongPeak.period[0].peak_frp.date='2000-01-01'
  assert.throws(()=>validateReport(wrongPeak,r.report_start,r.report_end),/peak disagrees/)
  const bad=structuredClone(r);bad.period[0].detection_count++
  assert.throws(()=>validateReport(bad,bad.report_start,bad.report_end),/reconcile/)
  assert.throws(()=>validateReport({...r,series:r.series.slice(1)},r.report_start,r.report_end),/missing calendar/)
  assert.throws(()=>validateReport(r,r.report_start,r.report_end,'different'),/selection changed/)
  assert.throws(()=>validateReport({...r,series:undefined},r.report_start,r.report_end),/incomplete/)
  const early=fixture('2002-04-01',123)
  const july3=early.series.findIndex(day=>day.date==='2002-07-03')
  record(early,july3,'terra',2);record(early,july3,'aqua',99) // The Aqua archive starts on the following day.
  record(early,july3+1,'terra',8);record(early,july3+1,'aqua',4)
  record(early,july3+2,'terra',12) // Post-transition Terra cannot replace missing Aqua.
  const edge=early.series.slice(july3,july3+3)
  for(const pass of ['all','day','night']){
    const before=2*calibration.hotspots[pass],after=4*calibration.hotspots[pass]
    const daily=dailySeries({...early,pass,series:edge})
    assert.deepEqual(daily.map(d=>d.raw),[2,4,null])
    assert.deepEqual(edge.map(day=>actualDay(day,pass).rawCount),[2,4,null])
    assert.deepEqual(daily.map(d=>d.adjustedPlatform),['terra','aqua','aqua'])
    assert.deepEqual(daily.map(d=>d.adjusted),[before,after,null])
    assert.deepEqual(edge.map(day=>actualDay(day,pass).correctedCount),[before,after,null])
  }
  assert.equal(historicalCalendarValue(edge[0].date,actualDay(edge[0],'all'),'count',true).source,'Harmonized Terra MODIS (estimate)')
  assert.equal(historicalCalendarValue(edge[1].date,actualDay(edge[1],'all'),'count',true).source,'Harmonized Aqua MODIS (estimate)')
  assert.equal(historicalCalendarValue(edge[0].date,actualDay(edge[0],'all'),'count',false).source,'Terra MODIS')
  assert.equal(historicalCalendarValue(edge[1].date,actualDay(edge[1],'all'),'count',false).source,'Aqua MODIS')
  assert.equal(historicalCalendarValue(r.series[2].date,actualDay(r.series[2],'all'),'count',false).value,4*calibration.hotspots.all)
  const cell=(cell_id,platform,detection_count)=>({cell_id,platform,detection_count,frp_sum_mw:detection_count,pass:'day',center:[0,0]})
  const modis=[cell('shared','terra',8),cell('shared','aqua',4),cell('terra-only','terra',7)]
  const weights=(rows,date)=>historicalCells(rows,date,false).map(c=>c.weight)
  assert.deepEqual(weights(modis,'2002-07-03'),[8,7])
  assert.deepEqual(weights(modis,'2002-07-04'),[4,0])
  assert.deepEqual(weights(modis,'2012-01-20'),[4,0])
  assert.deepEqual(weights([...modis,cell('viirs-only','snpp',10)],'2012-01-20'),[0,0,10])
  assert.equal(historicalCells(modis,'2002-07-04',false)[0].raw,12) // FRP keeps its existing aggregation.
  const july=countBins(early).rows.find(row=>row.date==='2002-07-01')
  assert.ok(Math.abs(july.adjusted-3*calibration.hotspots.all)<1e-10)
  assert.equal(july.nAdjusted,2)
  assert.equal(july.nAqua,1)
  const monthly=fixture('2011-12-01',123)
  record(monthly,0,'terra',2);record(monthly,1,'terra',6);record(monthly,1,'aqua',4)
  record(monthly,60,'snpp',10)
  summarize(monthly)
  const mb=countBins(monthly)
  assert.equal(mb.monthly,true);assert.equal(mb.rows[0].requested,31);assert.equal(mb.rows[0].raw,4);assert.equal(mb.rows[0].nModis,1);assert.equal(mb.rows[0].nAqua,1)
  assert.equal(mb.rows[0].viirs,null);assert.equal(mb.rows[1].nViirs,1)
  assert.equal(mb.rows.at(-1).requested,1) // partial last month is retained
  const evidence=reportEvidence(monthly,'2026-11-15T00:00:00Z')
  assert.equal(evidence.report_version,'firms-evidence-v3')
  assert.equal(evidence.derivations.counts.length,123)
  assert.equal(evidence.derivations.count_chart.rows[0].adjusted,4*calibration.hotspots.all)
  const {buildHistoricalPdf}=await vite.ssrLoadModule('/src/report/historicalPdf.ts')
  const font=(await readFile('src/report/NotoSans-Regular.ttf')).toString('base64')
  const empty=summarize(fixture('2011-01-01',1))
  Object.assign(empty,{dataset_release:'TEST FIXTURE',method_id:'test',quality_policy:'canonical',spatial_mode:'exact',geometry_version:'test',area:{kind:'preset',id:'test'}})
  const pdf=buildHistoricalPdf(empty,'Synthetic empty fixture - test only',font,'2026-11-15T00:00:00Z')
  assert.equal(pdf.getNumberOfPages(),9)
  assert.ok(pdf.output('arraybuffer').byteLength>1000)
  console.log('Report checks passed: Terra/Aqua and VIIRS boundaries, screen/PDF agreement, no fallback, pass coefficients, gaps, invalid FRP, paired days, denominators, partial months and reconciliation.')
}finally{await vite.close()}
