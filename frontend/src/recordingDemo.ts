import { useEffect, useState } from 'react'
import { tourRegions } from './cameraTour'
import type { Pass } from './data'
import { historicalRequest, loadHistoricalCalendar, loadHistoricalCells, loadHistoricalSelection, type PreparedHistory } from './historical'
import { initialSnapshot, type Snapshot } from './pins'

export function recordingSettings(snapshot:Snapshot):Snapshot {
  const focus=snapshot.region||snapshot.aoi?undefined:tourRegions.find(region=>region.id===snapshot.focus.id)
  return focus?{...snapshot,focus,areaMode:'countries',query:''}:initialSnapshot
}

export async function prepareRecordingHistory(pass:Pass,signal:AbortSignal) {
  const prepared=new Map<string,PreparedHistory>()
  // Limit concurrent archive scans while all four calendars warm up.
  for(let index=0;index<tourRegions.length;index+=2){
    await Promise.all(tourRegions.slice(index,index+2).map(async focus=>{
      const request=historicalRequest({...initialSnapshot,focus,pass})
      const selection=await loadHistoricalSelection(request,signal)
      const [days,cells]=await Promise.all([
        loadHistoricalCalendar(selection.query_id,signal),
        loadHistoricalCells(selection.query_id,focus.date,signal),
      ])
      prepared.set(request,{selection,days,cells:{date:focus.date,...cells}})
    }))
  }
  return prepared
}

export function useRecordingHistory(enabled:boolean,pass:Pass) {
  const [attempt,setAttempt]=useState(0)
  const key=pass+':'+attempt
  const [result,setResult]=useState<{key:string; history?:Map<string,PreparedHistory>; error?:string}>()
  useEffect(()=>{
    if(!enabled)return
    const controller=new AbortController()
    void prepareRecordingHistory(pass,controller.signal).then(history=>{
      if(!controller.signal.aborted)setResult({key,history})
    },problem=>{
      if(controller.signal.aborted)return
      controller.abort()
      setResult({key,error:problem instanceof Error?problem.message:String(problem)})
    })
    return ()=>controller.abort()
  },[enabled,key,pass])
  const visible=enabled&&result?.key===key?result:undefined
  return {history:visible?.history,error:visible?.error,retry:()=>setAttempt(value=>value+1)}
}
