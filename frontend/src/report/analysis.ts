import { aquaArchiveStart, calibration, harmonizeHistoricalCount } from '../calibration'

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
export const reportVersion='firms-evidence-v3'
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
export function dailyCount(day:ReportDay,pass:Pass) {
  const terra=day.platforms.find(p=>p.platform==='terra')?.detection_count??null
  const aqua=day.date<aquaArchiveStart?null:day.platforms.find(p=>p.platform==='aqua')?.detection_count??null
  const viirs=day.date<viirsArchiveStart?null:day.platforms.find(p=>p.platform==='snpp')?.detection_count??null
  const adjusted=harmonizeHistoricalCount(day.date,day.platforms,pass)
  return {date:day.date,raw:sum([terra,aqua]),aqua,adjusted:adjusted.value,adjustedPlatform:adjusted.platform,viirs}
}
export function dailySeries(report:HistoricalReport) {
  return report.series.map(day=>dailyCount(day,report.pass))
}
export type DailyCount=ReturnType<typeof dailyCount>
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
    raw:mean(days.map(d=>d.raw)),adjusted:mean(days.map(d=>d.adjusted)),viirs:mean(days.map(d=>d.viirs)),
    nModis:days.filter(d=>d.raw!==null).length,nAqua:days.filter(d=>d.aqua!==null).length,
    nAdjusted:days.filter(d=>d.adjusted!==null).length,nViirs:days.filter(d=>d.viirs!==null).length,
  }))}
}
export function pairedCounts(days:DailyCount[]) {
  const pairs=days.filter((d):d is DailyCount & {aqua:number;adjusted:number;viirs:number}=>d.adjustedPlatform==='aqua'&&d.aqua!==null&&d.adjusted!==null&&d.viirs!==null)
  const reference=sum(pairs.map(d=>d.viirs))
  const stats=(key:'aqua'|'adjusted')=>{
    const errors=pairs.map(d=>d[key]-d.viirs)
    const absolute=sum(errors.map(Math.abs))
    return {meanDifference:mean(errors),mae:mean(errors.map(Math.abs)),
      wape:reference&&absolute!==null?100*absolute/reference:null,
      bias:reference?100*(sum(errors)??0)/reference:null}
  }
  return {n:pairs.length,rawAqua:stats('aqua'),adjusted:stats('adjusted')}
}
// Block stale/incomplete payloads before making a scientific document.
export function validateReport(report:HistoricalReport,from:string,to:string,queryId?:string) {
  if(report.source!=='firms'||!Array.isArray(report.series)||report.report_start!==from||report.report_end!==to)
    throw new Error('Report payload is incomplete or has a different period. Update the historical API and retry.')
  if(queryId&&report.query_id!==queryId)throw new Error('Report selection changed. Please retry.')
  if(!Array.isArray(report.area_bounds)||report.area_bounds.length!==4||!report.area_bounds.every(finite))throw new Error('Report area bounds are missing. Update the historical API and retry.')
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
    const average=mean(days.map(d=>d.frp_sum_mw))
    if(average===null?summary.mean_observed_daily_frp_mw!==null:
      !finite(summary.mean_observed_daily_frp_mw)||Math.abs(average-summary.mean_observed_daily_frp_mw)>Math.max(1e-6,Math.abs(average)*1e-9))
      throw new Error('Report mean disagrees with observed-day values.')
    const valid=days.map((d,i)=>({date:report.series[i].date,value:d.frp_sum_mw})).filter(d=>d.value!==null)
    if(!valid.length){if(summary.peak_frp!==null)throw new Error('Unexpected FRP peak without observations.')}
    else{
      const peak=Math.max(...valid.map(d=>d.value!))
      if(!summary.peak_frp||!finite(summary.peak_frp.frp_sum_mw)||Math.abs(peak-summary.peak_frp.frp_sum_mw)>Math.max(1e-6,Math.abs(peak)*1e-9)||
        !valid.some(d=>d.date===summary.peak_frp?.date&&Math.abs(d.value!-peak)<=Math.max(1e-6,Math.abs(peak)*1e-9)))
        throw new Error('Report FRP peak disagrees with daily observations.')
    }
  }
}
export function reportEvidence(report:HistoricalReport,generatedAt:string) {
  validateReport(report,report.report_start,report.report_end)
  return {report_version:reportVersion,generated_at_utc:generatedAt,source_payload:report,
    derivations:{count_formula:'Terra MODIS detections before '+aquaArchiveStart+', Aqua MODIS detections from that UTC date onward, multiplied by K_COUNT[pass]',
      raw_modis_formula:'Sum available Terra and Aqua detections. Null if neither has records.',
      comparison_baseline:'Raw Aqua MODIS and adjusted Aqua MODIS on the same dates as observed VIIRS',
      aqua_archive_start:aquaArchiveStart,
      coefficients:calibration.hotspots,coefficient_source:'config/modis_viirs_coefficients.csv',
      selected_coefficient:calibration.hotspots[report.pass],viirs_archive_start:viirsArchiveStart,
      aggregation:report.series.length>120?'calendar-month mean of daily values with records':'daily',
      missing_policy:'Null when the selected platform has no observations for the date. No interpolation or platform substitution.',
      counts:dailySeries(report),count_chart:countBins(report),paired_count_diagnostics:pairedCounts(dailySeries(report))}}
}
