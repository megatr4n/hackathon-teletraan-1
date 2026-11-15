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
