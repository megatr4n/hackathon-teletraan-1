import { useEffect, useMemo, useState } from 'react'
import { calendarWeeks, datesInRange, weekIndex, weekRange } from './calendarWeeks'
import { clampDate, type Pass } from './data'
import { historicalRequest, loadHistoricalCalendar, loadHistoricalCells, loadHistoricalSelection, type PreparedHistory } from './historical'
import { builtInPins, type Snapshot } from './pins'

export function recordingSettings(snapshot:Snapshot,params:URLSearchParams):Snapshot {
  if(snapshot.region||snapshot.aoi)return snapshot
  const recordingPin=builtInPins.find(pin=>pin.snapshot.focus.id===snapshot.focus.id)?.snapshot??builtInPins[0].snapshot
  const from=params.has('from')?snapshot.from:recordingPin.from
  const to=params.has('to')?snapshot.to:recordingPin.to
  if(from>to)return recordingPin
  return {...recordingPin,from,to,date:clampDate(params.has('date')?snapshot.date:recordingPin.date,from,to),
    pass:snapshot.pass,harmonized:snapshot.harmonized,metric:snapshot.metric,
    calendarView:snapshot.calendarView,granularity:snapshot.granularity}
}

async function prepareRecordingHistory(requests:Map<string,Snapshot>,signal:AbortSignal) {
  const prepared=new Map<string,PreparedHistory>()
  const entries=[...requests]
  // Warm at most two regions at a time. Their default display is a week, including partial weeks.
  for(let index=0;index<entries.length;index+=2){
    await Promise.all(entries.slice(index,index+2).map(async ([request,snapshot])=>{
      const selection=await loadHistoricalSelection(request,signal)
      const week=weekRange(calendarWeeks[weekIndex(snapshot.date)],snapshot.from,snapshot.to)
      async function loadWeek(){
        const days:PreparedHistory['mapDays']=[]
        for(const date of datesInRange(week.from,week.to)){
          days.push({date,...await loadHistoricalCells(selection.query_id,date,signal)})
        }
        return days
      }
      const [days,mapDays]=await Promise.all([loadHistoricalCalendar(selection.query_id,signal),loadWeek()])
      prepared.set(request,{selection,days,mapDays})
    }))
  }
  return prepared
}

export function useRecordingHistory(enabled:boolean,pass:Pass) {
  const requests=useMemo(()=>new Map(enabled?builtInPins.map(({snapshot})=>[historicalRequest({...snapshot,pass}),snapshot]):[]),[enabled,pass])
  const [attempt,retry]=useState(0)
  const key=pass+':'+attempt
  const [result,setResult]=useState<{key:string;history?:Map<string,PreparedHistory>;error?:string}>()
  useEffect(()=>{
    if(!enabled)return
    const controller=new AbortController()
    const timer=window.setTimeout(()=>{
      void prepareRecordingHistory(requests,controller.signal).then(history=>{
        if(!controller.signal.aborted)setResult({key,history})
      },error=>{
        if(controller.signal.aborted)return
        controller.abort()
        setResult({key,error:error instanceof Error?error.message:String(error)})
      })
    },0)
    return ()=>{window.clearTimeout(timer);controller.abort()}
  },[enabled,key,requests])
  const visible=enabled&&result?.key===key?result:undefined
  return {requests,history:visible?.history,error:visible?.error,retry:()=>retry(value=>value+1)}
}
