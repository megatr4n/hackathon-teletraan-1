import assert from 'node:assert/strict'
import {createServer} from 'vite'
const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'})
try{
  const {dailySeries,countBins,pairedCounts,validateReport,reportEvidence}=await vite.ssrLoadModule('/src/report/analysis.ts')
  const {calibration}=await vite.ssrLoadModule('/src/calibration.ts')
  function fixture(start,n){
    const empty={detection_count:null,valid_frp_count:0,missing_frp_count:0,frp_sum_mw:null}
    const series=Array.from({length:n},(_,i)=>({date:new Date(Date.parse(start)+86400000*i).toISOString().slice(0,10),
      z_score:null,z_score_status:'insufficient_reference_years',z_score_reference_days:0,z_score_reference_years:0,
      platforms:['terra','aqua','snpp'].map(platform=>({platform,coverage_status:'unknown_coverage',by_pass:{},...empty}))}))
    const report={source:'firms',query_id:'q_fixture',dataset_manifest_sha256:'a'.repeat(64),pass:'all',
      report_start:start,report_end:series.at(-1).date,platforms:['terra','aqua','snpp'],series,day:series[0],period:[]}
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
        valid_frp_count:days.reduce((n,d)=>n+d.valid_frp_count,0),missing_frp_count:days.reduce((n,d)=>n+d.missing_frp_count,0)}
    }); return r
  }
  const r=fixture('2012-01-19',4)
  record(r,0,'terra',2);record(r,0,'snpp',99) // even a malformed pre-launch input cannot create a VIIRS chart value
  record(r,1,'terra',2);record(r,1,'aqua',3);record(r,1,'snpp',20)
  record(r,2,'terra',4,null) // count survives invalid FRP, no VIIRS substitution
  summarize(r)
  const rows=dailySeries(r)
  assert.equal(rows[0].viirs,null)
  assert.equal(rows[1].raw,5);assert.equal(rows[1].adjusted,5*calibration.hotspots.all);assert.equal(rows[1].viirs,20)
  assert.equal(rows[2].raw,4);assert.equal(rows[2].viirs,null);assert.equal(rows[3].raw,null)
  for(const pass of ['all','day','night'])assert.equal(dailySeries({...r,pass})[1].adjusted,5*calibration.hotspots[pass])
  const pair=pairedCounts(rows)
  assert.equal(pair.n,1);assert.equal(pair.raw.mae,15);assert.equal(pair.raw.meanDifference,-15);assert.equal(pair.raw.wape,75)
  assert.equal(pairedCounts([]).raw.wape,null)
  assert.equal(pairedCounts([{date:'2020-01-01',raw:1,adjusted:2,viirs:0}]).raw.wape,null)
  validateReport(r,r.report_start,r.report_end,r.query_id)
  const bad=structuredClone(r);bad.period[0].detection_count++
  assert.throws(()=>validateReport(bad,bad.report_start,bad.report_end),/reconcile/)
  assert.throws(()=>validateReport({...r,series:r.series.slice(1)},r.report_start,r.report_end),/missing calendar/)
  assert.throws(()=>validateReport(r,r.report_start,r.report_end,'different'),/selection changed/)
  assert.throws(()=>validateReport({...r,series:undefined},r.report_start,r.report_end),/incomplete/)
  const monthly=fixture('2011-12-01',123)
  record(monthly,0,'terra',2);record(monthly,1,'terra',6)
  record(monthly,60,'snpp',10)
  summarize(monthly)
  const mb=countBins(monthly)
  assert.equal(mb.monthly,true);assert.equal(mb.rows[0].requested,31);assert.equal(mb.rows[0].raw,4);assert.equal(mb.rows[0].nModis,2)
  assert.equal(mb.rows[0].viirs,null);assert.equal(mb.rows[1].nViirs,1)
  assert.equal(mb.rows.at(-1).requested,1) // partial last month is retained
  const evidence=reportEvidence(monthly,'2026-11-15T00:00:00Z')
  assert.equal(evidence.derivations.counts.length,123)
  assert.equal(evidence.derivations.count_chart.rows[0].adjusted,4*calibration.hotspots.all)
  console.log('Report checks passed: transition, no fallback, pass coefficients, gaps, invalid FRP, paired days, denominators, partial months and reconciliation.')
}finally{await vite.close()}
