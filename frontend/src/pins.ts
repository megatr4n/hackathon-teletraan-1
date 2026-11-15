import { firstDate, lastDate, scenarios, type Aoi, type Focus, type Pass } from './data'
import type { AreaMode, Region } from './geography'

export type Camera = { lat:number; lon:number; zoom:number; bearing:number; pitch:number }
export type MapOptions = { grid:boolean; satellite:boolean; ecosystems:boolean }
export type Metric = 'frp' | 'count' | 'z'
export type CalendarView = 'grid' | 'ridge'
export type Snapshot = {
  focus:Focus; region:Region|null; date:string; from:string; to:string; pass:Pass; harmonized:boolean;
  areaMode:AreaMode; aoi:Aoi|null; radius:number; query:string; options:MapOptions; camera:Camera;
  metric:Metric; calendarView:CalendarView
}
export type Pin = { id:string; name:string; snapshot:Snapshot }
export const defaultOptions:MapOptions={grid:true,satellite:false,ecosystems:false}
export const initialSnapshot:Snapshot={
  focus:scenarios[0],region:null,date:scenarios[0].date,from:firstDate,to:lastDate,pass:'all',harmonized:true,
  areaMode:'countries',aoi:null,radius:50,query:'',options:defaultOptions,
  camera:{lon:scenarios[0].center[0],lat:scenarios[0].center[1],zoom:scenarios[0].zoom,bearing:36,pitch:48},
  metric:'frp',calendarView:'grid',
}
const defaults:Pin[]=scenarios.map(focus=>({id:'demo-'+focus.id,name:focus.short,snapshot:{...initialSnapshot,focus,date:focus.date,
  camera:{...initialSnapshot.camera,lon:focus.center[0],lat:focus.center[1],zoom:focus.zoom}}}))
const storageKey='teletraan-1-pins-v1'
export function readPins():Pin[] {
  try {
    const value=localStorage.getItem(storageKey)
    if (value===null) return defaults
    const stored:unknown=JSON.parse(value)
    if (Array.isArray(stored) && stored.every(pin=>typeof pin?.id==='string'&&typeof pin?.name==='string'&&pin.snapshot?.focus&&pin.snapshot?.camera)) return stored
  } catch { /* use the built-in scenarios if storage is unavailable */ }
  return defaults
}
export function writePins(pins:Pin[]) {
  try { localStorage.setItem(storageKey,JSON.stringify(pins)); return true } catch { return false }
}
