import { useEffect, useState } from 'react'
import type { FeatureCollection, MultiPolygon } from 'geojson'
import { historicalFetch } from './historical'

type ZoneLevel = 'outer' | 'elevated' | 'core'
type ZoneProperties = {
  cluster:string
  level:ZoneLevel
  hotspots:number
  min_years:number
  max_years:number
}

type ZoneCollection = FeatureCollection<MultiPolygon, ZoneProperties> & {
  dataset_manifest_sha256:string
  from:string
  to:string
  reference_years:number
  minimum_years:number
}

export const zoneLevels = {
  outer:{color:'#ffe36b', label:'Recurring'},
  elevated:{color:'#ff9a3d', label:'High recurrence'},
  core:{color:'#ff535e', label:'Highest recurrence'},
}

// Keep a small session cache because country responses can contain many polygons.
const zoneCache=new Map<string,ZoneCollection>()
const maxCachedAreas=8

export function useFireZones(request:string|undefined, release:string|undefined) {
  const [attempt,setAttempt]=useState(0)
  const [result,setResult]=useState<{key:string; data?:ZoneCollection; error?:string}>()
  const cacheKey=request&&release?release+'\n'+request:undefined
  const cached=cacheKey?zoneCache.get(cacheKey):undefined
  const key=request===undefined?undefined:attempt+'\n'+(release??'')+'\n'+request
  useEffect(()=>{
    if(request===undefined||key===undefined)return
    if(cacheKey&&cached){
      zoneCache.delete(cacheKey)
      zoneCache.set(cacheKey,cached)
      return
    }
    const controller=new AbortController()
    void historicalFetch('/fire-zones',{
      method:'POST',headers:{'Content-Type':'application/json'},body:request,signal:controller.signal,
    }).then(response=>response.json()).then((data:ZoneCollection)=>{
      if(controller.signal.aborted)return
      if(cacheKey&&data.dataset_manifest_sha256===release){
        zoneCache.set(cacheKey,data)
        if(zoneCache.size>maxCachedAreas){
          const oldest=zoneCache.keys().next().value
          if(oldest!==undefined)zoneCache.delete(oldest)
        }
      }
      setResult({key,data})
    }).catch((error:unknown)=>{
      if(!controller.signal.aborted)setResult({key,error:error instanceof Error?error.message:'Fire zones unavailable'})
    })
    return ()=>controller.abort()
  },[key,request,release,cacheKey,cached])
  return {
    data:cached??(key!==undefined&&result?.key===key?result.data:undefined),
    error:!cached&&key!==undefined&&result?.key===key?result.error:undefined,
    retry:()=>setAttempt(value=>value+1),
  }
}
