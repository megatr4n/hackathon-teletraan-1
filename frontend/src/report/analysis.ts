import { calibration } from '../calibration'

export type Platform = 'terra'|'aqua'|'snpp'
export type Pass = 'all'|'day'|'night'
export type Metrics = { detection_count:number|null; valid_frp_count:number; missing_frp_count:number; frp_sum_mw:number|null }
export type Observation = Metrics & {platform:Platform; coverage_status:string; by_pass:Record<string,Metrics>}
export type ReportDay = {date:string; platforms:Observation[]; z_score:number|null; z_score_status:string; z_score_reference_years:number; z_score_reference_days:number}
export type Summary = Metrics & {platform:Platform; requested_days:number; days_with_records:number; days_with_valid_metric:number; mean_observed_daily_frp_mw:number|null; peak_frp:{date:string;frp_sum_mw:number}|null}
export type HistoricalReport = {
  source:'firms'; query_id:string; dataset_release:string; dataset_manifest_sha256:string
  geometry_version:string; quality_policy:string; spatial_mode:string; method_id:string
  pass:Pass; from:string; to:string; platforms:Platform[]; area:Record<string,unknown>; area_bounds:[number,number,number,number]
  report_start:string; report_end:string; day:ReportDay; series:ReportDay[]; period:Summary[]
  methodology:Record<string,unknown>
}
export const reportVersion='firms-evidence-v1'
export const viirsArchiveStart='2012-01-20'
export const platformLabels={terra:'Terra MODIS',aqua:'Aqua MODIS',snpp:'S-NPP VIIRS'}
export const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)
export function sum(values:(number|null|undefined)[]):number|null {
  const numbers=values.filter(finite)
  return numbers.length?numbers.reduce((a,b)=>a+b,0):null
}
export function mean(values:(number|null|undefined)[]):number|null {
  const numbers=values.filter(finite)
  return numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:null
}
export function quantile(values:number[],q:number):number|null {
  if(!values.length)return null
  const sorted=[...values].sort((a,b)=>a-b), index=(sorted.length-1)*q, lo=Math.floor(index), hi=Math.ceil(index)
  return sorted[lo]+(sorted[hi]-sorted[lo])*(index-lo)
}
export function dailySeries(report:HistoricalReport) {
  return report.series.map(day=>{
    const raw=sum(day.platforms.filter(p=>p.platform!=='snpp').map(p=>p.detection_count))
    return {date:day.date,raw,adjusted:raw===null?null:raw*calibration.hotspots[report.pass],
      viirs:day.date<viirsArchiveStart?null:day.platforms.find(p=>p.platform==='snpp')?.detection_count??null}
  })
}
export type DailyCount=ReturnType<typeof dailySeries>[number]
export function bins<T extends {date:string}>(days:T[],monthly:boolean):T[][] {
  const groups=new Map<string,T[]>()
  for(const day of days){
    const key=monthly?day.date.slice(0,7):day.date
    const group=groups.get(key)??[]; group.push(day); groups.set(key,group)
  }
  return [...groups.values()]
}
export function countBins(report:HistoricalReport) {
  const monthly=report.series.length>120
  return {monthly,rows:bins(dailySeries(report),monthly).map(days=>({
    date:days[0].date, end:days.at(-1)!.date, requested:days.length,
    ...Object.fromEntries((['raw','adjusted','viirs'] as const).map(key=>[key,mean(days.map(d=>d[key]))])),
    nModis:days.filter(d=>d.raw!==null).length,nViirs:days.filter(d=>d.viirs!==null).length,
  })) as {date:string;end:string;requested:number;raw:number|null;adjusted:number|null;viirs:number|null;nModis:number;nViirs:number}[]}
}
export function pairedCounts(days:DailyCount[]) {
  const pairs=days.filter((d):d is DailyCount & {raw:number;adjusted:number;viirs:number}=>d.raw!==null&&d.adjusted!==null&&d.viirs!==null)
  const reference=sum(pairs.map(d=>d.viirs))
  const stats=(key:'raw'|'adjusted')=>{
    const errors=pairs.map(d=>d[key]-d.viirs)
    const absolute=sum(errors.map(Math.abs))
    return {meanDifference:mean(errors),mae:mean(errors.map(Math.abs)),
      wape:reference&&absolute!==null?100*absolute/reference:null,
      bias:reference?100*(sum(errors)??0)/reference:null}
  }
  return {n:pairs.length,raw:stats('raw'),adjusted:stats('adjusted')}
}
// Block stale/incomplete payloads before making a scientific document.
export function validateReport(report:HistoricalReport,from:string,to:string,queryId?:string) {
  if(report.source!=='firms'||!Array.isArray(report.series)||report.report_start!==from||report.report_end!==to)
    throw new Error('Report payload is incomplete or has a different period. Update the historical API and retry.')
  if(queryId&&report.query_id!==queryId)throw new Error('Report selection changed. Please retry.')
  if(!/^[a-f0-9]{64}$/.test(report.dataset_manifest_sha256))throw new Error('Missing dataset fingerprint.')
  const expected=Math.round((Date.parse(to)-Date.parse(from))/86400000)+1
  if(report.series.length!==expected)throw new Error('Report contains missing calendar days.')
  const seen=new Set<string>()
  report.series.forEach((day,index)=>{
    const expectedDate=new Date(Date.parse(from)+index*86400000).toISOString().slice(0,10)
    if(day.date!==expectedDate||seen.has(day.date))throw new Error('Report dates are incomplete or unordered.')
    seen.add(day.date)
    if(new Set(day.platforms.map(p=>p.platform)).size!==report.platforms.length||day.platforms.length!==report.platforms.length)
      throw new Error('Report platform series is incomplete.')
    for(const p of day.platforms){
      if(!report.platforms.includes(p.platform))throw new Error('Unexpected platform in report.')
      for(const n of [p.detection_count,p.frp_sum_mw])if(n!==null&&(!finite(n)||n<0))throw new Error('Invalid observation in report.')
      if(!Number.isInteger(p.valid_frp_count)||!Number.isInteger(p.missing_frp_count)||p.valid_frp_count<0||p.missing_frp_count<0||
        (p.detection_count!==null&&(!Number.isInteger(p.detection_count)||p.valid_frp_count+p.missing_frp_count!==p.detection_count)))
        throw new Error('Inconsistent FRP record counts.')
    }
  })
  if(report.period.some((p,i)=>p.platform!==report.platforms[i]))throw new Error('Platform summaries are out of order.')
  if(report.period.length!==report.platforms.length||new Set(report.period.map(p=>p.platform)).size!==report.platforms.length)
    throw new Error('Incomplete platform summary.')
  for(const summary of report.period){
    const days=report.series.map(d=>d.platforms.find(p=>p.platform===summary.platform)!)
    if(days.some(d=>!d))throw new Error('Unknown summary platform.')
    for(const key of ['detection_count','frp_sum_mw','valid_frp_count','missing_frp_count'] as const){
      const actual=sum(days.map(d=>d[key])),expected=summary[key]
      if(actual===null?expected!==null:expected===null||!finite(expected)||Math.abs(actual-expected)>Math.max(1e-6,Math.abs(actual)*1e-9))
        throw new Error('Report daily values do not reconcile with the platform totals.')
    }
    if(summary.requested_days!==days.length||summary.days_with_records!==days.filter(d=>d.detection_count!==null).length||
      summary.days_with_valid_metric!==days.filter(d=>d.frp_sum_mw!==null).length)throw new Error('Report observation denominators disagree.')
  }
}
export function reportEvidence(report:HistoricalReport,generatedAt:string) {
  validateReport(report,report.report_start,report.report_end)
  return {report_version:reportVersion,generated_at_utc:generatedAt,source_payload:report,
    derivations:{count_formula:'(Terra detections + Aqua detections) * K_COUNT[pass]; sum available records; all missing = null',
      coefficients:calibration.hotspots,coefficient_source:'config/modis_viirs_coefficients.csv',
      selected_coefficient:calibration.hotspots[report.pass],viirs_archive_start:viirsArchiveStart,
      aggregation:report.series.length>120?'calendar-month mean of daily values with records':'daily',
      missing_policy:'null preserved; no interpolation, imputation or VIIRS fallback',
      counts:dailySeries(report),count_chart:countBins(report),paired_count_diagnostics:pairedCounts(dailySeries(report))}}
}
