import { useEffect, useState } from 'react'
import { areaPolygon, firstDate, lastDate } from './data'
import type { Snapshot } from './pins'

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

export function useHistorical(enabled:boolean, request:string, date:string) {
  const [query,setQuery]=useState<{key:string; days:Day[]}|null>(null)
  const [created,setCreated]=useState<{key:string; selection:Selection}|null>(null)
  const [activeDay,setActiveDay]=useState<{key:string; value:Day}|null>(null)
  const [error,setError]=useState<{key:string; message:string}|null>(null)
  const [attempt,retry]=useState(0)
  const key=request+'\n'+attempt
  const current=enabled&&query?.key===key?query:null
  const selection=enabled&&created?.key===key?created.selection:undefined
  const mapKey=key+'\n'+date
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
  return {selection, days:current?.days, day:current?.days.find(row=>row.date===date)??(activeDay?.key===mapKey?activeDay.value:undefined),
    error:error?.key===key||error?.key===mapKey?error.message:null, retry:()=>retry(value=>value+1)}
}
