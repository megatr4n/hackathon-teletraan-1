import { useEffect, useState } from 'react'
import type { MultiPolygon, Polygon } from 'geojson'
import { areaPolygon, firstDate, lastDate, type MapCell, type Coord, type Pass } from './data'
import { calibration, periodFrpMinimumDays } from './calibration'
import type { Metric, Snapshot } from './pins'

const configuredApi = import.meta.env.VITE_FIRMS_API
export const historicalApi = configuredApi===undefined?undefined:import.meta.env.DEV?'':configuredApi.replace(/\/$/, '')

export type Selection = { query_id: string; dataset_release: string }

const presets: Record<string,string> = {chernobyl:'ua-east',california:'us-west',amazon:'amazon',australia:'australia'}

export function historicalRequest(settings:Snapshot) {
  const {aoi,areaMode,region,focus,pass}=settings
  let area
  if(areaMode==='custom'&&aoi?.type==='circle'){
    area={kind:'circle',center:aoi.center,radius_km:aoi.radius}
  }else if(areaMode==='custom'&&aoi?.type==='lasso'){
    area={kind:'geometry',geometry:areaPolygon(aoi)}
  }else if(region){
    area={kind:region.kind,id:region.id,parent_id:region.kind==='admin'?region.country:undefined}
  }else if(presets[focus.id]){
    area={kind:'preset',id:presets[focus.id]}
  }else{
    area={kind:'circle',center:focus.center,radius_km:settings.radius}
  }
  return JSON.stringify({area,from:firstDate,to:lastDate,pass})
}

export async function historicalFetch(path:string, init?:RequestInit) {
  if(historicalApi===undefined)throw new Error("Historical API is not configured")
  const response=await fetch(historicalApi+'/api/v2'+path,init)
  if(!response.ok){
    const error=await response.json().catch(()=>null)
    throw new Error(error?.detail?.message ?? 'Historical request failed ('+response.status+')')
  }
  return response
}

export type Platform = 'terra' | 'aqua' | 'snpp'
type Metrics = {
  detection_count: number | null
  valid_frp_count: number
  missing_frp_count: number
  frp_sum_mw: number | null
}
type Observed = Metrics & {
  platform: Platform
  coverage_status: 'observed_records' | 'unknown_coverage' | 'outside_observed_range'
  by_pass: Partial<Record<'day'|'night'|'unknown',Metrics>>
}
export type ScoreStatus = 'available' | 'no_modis_frp' | 'insufficient_reference_years' | 'zero_reference_variance' | 'not_requested'
type Day = {
  date:string
  platforms:Observed[]
  z_score:number|null
  z_score_status:ScoreStatus
  z_score_reference_years:number
  z_score_reference_days:number
}

type CellRow = Metrics & {
  cell_id: string
  center: Coord
  platform: Platform
  pass: Exclude<Pass,'all'> | 'unknown'
  geometry: Polygon | MultiPolygon
}

export const gridParams='square_km=3'

export function useHistorical(enabled:boolean, request:string, date:string) {
  const [query,setQuery]=useState<{key:string; days:Day[]}|null>(null)
  const [created,setCreated]=useState<{key:string; selection:Selection}|null>(null)
  const [map,setMap]=useState<{key:string; rows:CellRow[]; complete:boolean}|null>(null)
  const [activeDay,setActiveDay]=useState<{key:string; value:Day}|null>(null)
  const [error,setError]=useState<{key:string; message:string}|null>(null)
  const [attempt,retry]=useState(0)
  const key=request+'\n'+attempt
  const current=enabled&&query?.key===key?query:null
  const selection=enabled&&created?.key===key?created.selection:undefined
  const mapKey=key+'\n'+date
  const visible=enabled&&map?.key===mapKey?map:null
  useEffect(()=>{
    if(!enabled)return
    const controller=new AbortController()
    const signal=controller.signal
    const run=async()=>{
      const response=await historicalFetch('/queries',{
        method:'POST',headers:{'Content-Type':'application/json'},body:request,signal,
      })
      const selection:Selection=await response.json()
      if(!signal.aborted)setCreated({key,selection})
    }
    const timer=window.setTimeout(()=>void run().catch(problem=>{
      if(!signal.aborted)setError({key,message:String(problem.message)})
    }),200)
    return ()=>{clearTimeout(timer);controller.abort()}
  },[enabled,key,request])
  const queryId=selection?.query_id
  const calendarReady=Boolean(current)
  useEffect(()=>{
    if(!queryId||calendarReady)return
    const controller=new AbortController()
    const signal=controller.signal
    void historicalFetch('/queries/'+queryId+'/calendar',{signal})
      .then(response=>response.json())
      .then(calendar=>{if(!signal.aborted)setQuery({key,days:calendar.days})})
      .catch(problem=>{if(!signal.aborted)setError({key,message:String(problem.message)})})
    return ()=>controller.abort()
  },[queryId,calendarReady,key])
  useEffect(()=>{
    if(!queryId||calendarReady)return
    const controller=new AbortController()
    void historicalFetch('/queries/'+queryId+'/days/'+date+'?include_z_score=false',{signal:controller.signal})
      .then(response=>response.json())
      .then(value=>{if(!controller.signal.aborted)setActiveDay({key:mapKey,value})})
      .catch(problem=>{if(!controller.signal.aborted)setError({key:mapKey,message:String(problem.message)})})
    return ()=>controller.abort()
  },[queryId,date,mapKey,calendarReady])
  useEffect(()=>{
    if(!enabled||!queryId)return
    const controller=new AbortController()
    const signal=controller.signal
    const run=async()=>{
      const base='/queries/'+queryId+'/days/'+date+'/cells?'+gridParams+'&limit=5000'
      const rows:CellRow[]=[]
      let cursor:string|null=null
      do{
        const response=await historicalFetch(base+(cursor?'&cursor='+encodeURIComponent(cursor):''),{signal})
        const result:{cells:CellRow[];next_cursor:string|null}=await response.json()
        rows.push(...result.cells)
        cursor=result.next_cursor
      }while(cursor&&rows.length<20000)
      if(!signal.aborted)setMap({key:mapKey,rows,complete:cursor===null})
    }
    void run().catch(problem=>{
      if(!signal.aborted)setError({key:mapKey,message:String(problem.message)})
    })
    return ()=>controller.abort()
  },[enabled,queryId,date,mapKey])
  return {selection, days:current?.days, day:current?.days.find(row=>row.date===date)??(activeDay?.key===mapKey?activeDay.value:undefined),
    rows:visible?.rows, complete:visible?.complete,
    error:error?.key===key||error?.key===mapKey?error.message:null, retry:()=>retry(value=>value+1)}
}

export const snppArchiveStart='2012-01-20'

export function nullableSum(values:(number|null|undefined)[]) {
  const valid=values.filter((value):value is number=>typeof value==='number')
  return valid.length?valid.reduce((sum,value)=>sum+value,0):null
}

export function actualDay(day:Day|undefined, pass:Pass) {
  const modis=day?.platforms.filter(row=>row.platform!=='snpp')??[]
  const viirs=day?.platforms.find(row=>row.platform==='snpp')
  const rawCount=nullableSum(modis.map(row=>row.detection_count))
  const raw=nullableSum(modis.map(row=>row.frp_sum_mw))
  const corrected=nullableSum(modis.flatMap(row=>(['day','night'] as const).map(phase=>{
    const value=row.by_pass[phase]?.frp_sum_mw
    return typeof value==='number'?value*calibration.dailyFrp[phase]:null
  })))
  return {raw,rawCount,corrected,correctedCount:rawCount===null?null:rawCount*calibration.hotspots[pass],
    viirs:viirs?.frp_sum_mw??null,viirsCount:viirs?.detection_count??null}
}

type ActualDay = ReturnType<typeof actualDay>
export function historicalCalendarValue(date:string, day:ActualDay|undefined, metric:Exclude<Metric,'z'>, harmonized:boolean) {
  const count=metric==='count'
  const afterTransition=date>=snppArchiveStart
  const viirs=day?.[count?'viirsCount':'viirs']??null
  if(afterTransition&&viirs!==null){
    return {value:viirs,source:'VIIRS S-NPP',details:undefined}
  }
  if(afterTransition||harmonized){
    const modisEstimate=day?.[count?'correctedCount':'corrected']??null
    const missing=afterTransition?'No VIIRS or MODIS value':'No MODIS value to harmonize'
    return {
      value:modisEstimate,
      source:'Harmonized MODIS (estimate)',
      details:modisEstimate===null?missing:undefined,
    }
  }
  const modis=day?.[count?'rawCount':'raw']??null
  return {value:modis,source:'MODIS',details:modis===null?'No MODIS value':undefined}
}

export function historicalCells(rows:CellRow[], date:string, harmonized:boolean):MapCell[] {
  const groups=new Map<string,CellRow[]>()
  for(const row of rows){
    const group=groups.get(row.cell_id)
    if(group)group.push(row)
    else groups.set(row.cell_id,[row])
  }
  const afterTransition=date>=snppArchiveStart
  const modisValue=(row:CellRow)=>{
    if(row.frp_sum_mw===null||!(afterTransition||harmonized))return row.frp_sum_mw
    return row.pass==='unknown'?null:row.frp_sum_mw*calibration.dailyFrp[row.pass]
  }
  return Array.from(groups,([id,group])=>{
    const viirs=group.filter(row=>row.platform==='snpp')
    const modis=group.filter(row=>row.platform!=='snpp')
    const viirsFrp=afterTransition?nullableSum(viirs.map(row=>row.frp_sum_mw)):null
    return {id,center:group[0].center,geometry:group[0].geometry,raw:viirsFrp??nullableSum(modis.map(modisValue)),
      weight:group.reduce((sum,row)=>sum+(row.detection_count??0),0),pass:group.some(row=>row.pass==='day')?'day':'night'}
  })
}

export function scoreDetails(day:Day|undefined) {
  if(!day||day.z_score_status==='not_requested')return 'Seasonal baseline not loaded'
  if(day.z_score_status==='no_modis_frp')return 'No MODIS FRP reading'
  if(day.z_score_status==='insufficient_reference_years')return `Only ${day.z_score_reference_years} reference years (minimum 8)`
  if(day.z_score_status==='zero_reference_variance')return 'No variation in reference FRP'
  return `${day.z_score_reference_days} reference days in ${day.z_score_reference_years} other years`
}

const metricFields=['raw','rawCount','corrected','correctedCount','viirs','viirsCount'] as const

export function actualPeriod(rows:{date:string; values:ActualDay}[], days:number, pass:Pass) {
  const usePeriodCoefficient=days>=periodFrpMinimumDays
  const periods=rows.map(row=>{
    const {raw}=row.values
    return {...row,values:{...row.values,corrected:usePeriodCoefficient&&raw!==null?raw*calibration.periodFrp[pass]:row.values.corrected}}
  })
  const totals=Object.fromEntries(metricFields.map(field=>[field,nullableSum(periods.map(row=>row.values[field]))])) as ActualDay
  const denominators=Object.fromEntries(metricFields.map(field=>[field,periods.filter(row=>row.values[field]!==null).length])) as Record<keyof ActualDay,number>
  const peak=periods.reduce<typeof periods[number]|undefined>((current,row)=>
    row.values.corrected!==null&&(!current||row.values.corrected>(current.values.corrected??0))?row:current,undefined)
  return {totals,denominators,peak,activeDays:periods.filter(row=>row.values.rawCount!==null||row.values.viirsCount!==null).length,usePeriodCoefficient}
}
