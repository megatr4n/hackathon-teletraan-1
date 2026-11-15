import { startTransition, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Activity, ArrowDown, ArrowDownToLine, ArrowUpRight, Bookmark, BookmarkPlus, Camera as CameraIcon, Circle, ChevronLeft, ChevronRight, Clock3, CodeXml, Crosshair, Database, FileText, Focus as FocusIcon, Grid2X2, Layers3, Lasso, Leaf, MapPin, Puzzle as PuzzleIcon, Ruler, Search, SlidersHorizontal, Satellite, TriangleAlert, X, Zap } from 'lucide-react'
import { areaPolygon, cellPolygon, clampDate, doy, firstDate, maxCircleRadius, number, prettyDate, territories, type Aoi, type Cell, type Coord } from './data'
import { calibration, calibrationAccuracy } from './calibration'
import { cellObservations, dailyEstimates, dailyStats, dateIndex, periodStats, viirsStart } from './estimates'
import { calendarWeeks, datesInRange, nextWeekDate, sumMapCells, summarizeWeek, weekIndex, weekRange } from './calendarWeeks'
import { archiveDates, observations } from './observations'
import { countryOptions, emptyRegions, focusForRegion, geography, type AreaMode, type Region, type RegionCollection, type RegionFeature } from './geography'
import { MapStage, type Tool } from './MapStage'
import { initialSnapshot, readPins, writePins, type Camera, type Pin, type Snapshot } from './pins'
import { Timeline } from './Timeline'
import { Button, InfoTip, Segmented, frpHelp, hotspotHelp, zScoreHelp } from './ui'
import { PuzzleDropdown } from './PuzzlePanels'
import { puzzleFocus, type Puzzle } from './dailyPuzzle'
import { useDailyPuzzle } from './useDailyPuzzle'
import type { HistoricalReport } from './statisticalReport'
import { historicalApi, historicalFetch, gridParams, historicalCells, historicalRequest, useHistorical, actualDay, historicalCalendarValue, scoreDetails, actualPeriod, snppArchiveStart } from './historical'
import { snapshotFromUrl, updateViewUrl } from './viewLink'

import { cinematicTrack, tourRegions, type CameraCommand, type CameraDestination } from './cameraTour'
function UtcClock() {
  const [time,setTime]=useState(()=>new Date().toISOString().slice(11,19))
  useEffect(()=>{
    const timer=window.setInterval(()=>setTime(new Date().toISOString().slice(11,19)),1000)
    return ()=>clearInterval(timer)
  },[])
  return <span className="mission-clock mono" aria-label="UTC clock"><Clock3 size={13}/>{time} <b>UTC</b></span>
}

const narrowWorkbench='(max-width: 900px)'
const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
const countryAliases = new Map(territories.map(country=>[country.iso3,normalize(country.name_uk)]))

function RegionSearch({query,mode,options,onQuery,onChoose}:{query:string;mode:AreaMode;options:Region[];onQuery:(query:string)=>void;onChoose:(region:Region)=>void}) {
  const [open,setOpen]=useState(false)
  const [active,setActive]=useState(0)
  const resultsId=useId()
  const placeholder=mode==='ecoregions'?'Search WWF ecoregions…':'Search country or territory…'
  const results=useMemo(()=>{
    const term=normalize(query.trim())
    if(!term) return mode==='ecoregions'?options.slice(0,6):['UKR','CAN','GRC','BRA','ESP'].flatMap(id=>options.filter(region=>region.id===id))
    const matches=options.filter(region=>normalize(region.name).includes(term)||normalize(region.id).includes(term)||
      (region.kind==='country'&&countryAliases.get(region.id)?.includes(term)))
    return matches.sort((a,b)=>{
      const rank=(region:Region)=>normalize(region.name)===term?0:normalize(region.name).startsWith(term)?(region.kind==='country'?1:2):3
      return rank(a)-rank(b)||a.name.localeCompare(b.name)
    }).slice(0,8)
  },[query,options,mode])
  function choose(region:Region) {setOpen(false);onChoose(region)}
  return <div className="country-search" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false)}}>
    <Search size={16}/><input aria-label={placeholder.slice(0,-1)} role="combobox" aria-expanded={open} aria-controls={resultsId}
      aria-autocomplete="list" aria-activedescendant={open&&results[active]?resultsId+'-'+active:undefined} placeholder={placeholder} value={query}
      onFocus={()=>{setOpen(true);setActive(0)}} onChange={event=>{onQuery(event.target.value);setOpen(true);setActive(0)}}
      onKeyDown={event=>{
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();setOpen(true);setActive(i=>Math.max(0,Math.min(results.length-1,i+(event.key==='ArrowDown'?1:-1))))
        }
        if(event.key==='Enter'&&results[active]){event.preventDefault();choose(results[active])}
        if(event.key==='Escape'&&open){event.preventDefault();setOpen(false)}
      }}/>
    {open&&<div className="country-results" role="listbox" id={resultsId}>{results.length?results.map((region,i)=><button type="button"
      key={region.kind+':'+region.country+':'+region.id} id={resultsId+'-'+i} role="option" aria-selected={i===active} onMouseEnter={()=>setActive(i)}
      onMouseDown={event=>event.preventDefault()} onClick={()=>choose(region)}>{region.name}<span className="mono">{region.kind==='admin'?region.country:region.kind==='country'?region.id:'WWF'}</span></button>):<span>No matching areas</span>}</div>}
  </div>
}

function RadiusField({value,onChange}:{value:number;onChange:(value:number)=>void}) {
  const [draft,setDraft]=useState<string|null>(null)
  const formatted=String(Number(value.toFixed(2)))
  return <input aria-label="Radius in kilometers" type="number" min=".01" max={maxCircleRadius} step="any" value={draft??formatted}
    onChange={event=>{
      setDraft(event.target.value)
      const next=event.target.valueAsNumber
      if(next>=.01&&next<=maxCircleRadius)onChange(next)
    }}
    onBlur={event=>{if(draft!==null)onChange(event.target.valueAsNumber);setDraft(null)}}
    onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/>
}

function download(name:string,content:string|Blob,type?:string) {
  const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}))
  const link=document.createElement('a')
  link.href=url
  link.download=name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),1500)
}
const signed=(value:number)=>(value>=0?'+':'')+Math.round(value)+'%'
const fmt=(value:number)=>number(Math.round(value))
const display=(value:number|null|undefined, formatter=fmt)=>value==null?'—':formatter(value)
const units=(value:number,unit:string)=><>{number(value)} <small>{unit}</small></>

function SensorRow({label,value,unit,active}:{label:string;value:string;unit?:string;active?:boolean}) {
  return <div className={'analysis-row '+(active?'value-active':'')}><span>{label}</span><strong className="mono">{value} {unit&&<small>{unit}</small>}</strong></div>
}

export function App() {
  const [settings,setSettings]=useState(()=>snapshotFromUrl())
  const {focus,region,date,from,to,pass,harmonized,areaMode,aoi,radius,query,options,metric,calendarView}=settings
  const camera=useRef(settings.camera)
  const [command,setCommand]=useState<CameraCommand|null>(()=>settings===initialSnapshot?null:{camera:settings.camera,duration:0})
  const [filtersOpen,setFiltersOpen]=useState(()=>!window.matchMedia(narrowWorkbench).matches)
  const [analyticsOpen,setAnalyticsOpen]=useState(()=>!window.matchMedia(narrowWorkbench).matches)
  useEffect(()=>{
    const layout=window.matchMedia(narrowWorkbench)
    const closePanels=()=>{if(layout.matches){setFiltersOpen(false);setAnalyticsOpen(false)}}
    layout.addEventListener('change',closePanels)
    return ()=>layout.removeEventListener('change',closePanels)
  },[])
  const [tool,setTool]=useState<Tool>(null)
  const [circlePreviewRadius,setCirclePreviewRadius]=useState<number|null>(null)
  const [dialog,setDialog]=useState(false)
  const [playing,setPlaying]=useState(false)
  const [message,setMessage]=useState('')
  const [exportingReport,setExportingReport]=useState(false)
  const [measuring,setMeasuring]=useState(false)
  const [orbiting,setOrbiting]=useState(false)
  const [tourStop,setTourStop]=useState(0)
  const tour=useRef<{original:Snapshot;camera:Camera;stops:Snapshot[]}|null>(null)
  const [pins,setPins]=useState(readPins)
  const [pinMenu,setPinMenu]=useState(false)
  const [pinDialog,setPinDialog]=useState(false)
  const [pinName,setPinName]=useState('')
  const pinDock=useRef<HTMLDivElement>(null)
  const hasSelectedDay=settings.granularity==='day'
  const [countries,setCountries]=useState(emptyRegions)
  const [admins,setAdmins]=useState(emptyRegions)
  const [adminIndex,setAdminIndex]=useState<Region[]>([])
  const [ecoregions,setEcoregions]=useState(emptyRegions)
  const [geographyError,setGeographyError]=useState('')
  const adminCountry=areaMode==='countries'?region?.country:undefined

  useEffect(()=>{
    let active=true
    geography<RegionCollection>('countries').then(value=>{if(active)setCountries(value)}).catch(()=>{if(active)setGeographyError('Country boundaries unavailable')})
    geography<Region[]>('admin-index').then(value=>{if(active)setAdminIndex(value)}).catch(()=>{if(active)setGeographyError('Administrative search unavailable')})
    return ()=>{active=false}
  },[])
  useEffect(()=>{
    setAdmins(emptyRegions)
    if(!adminCountry||!adminIndex.some(entry=>entry.country===adminCountry))return
    let active=true
    geography<RegionCollection>('admin/'+adminCountry).then(value=>{if(active)setAdmins(value)})
      .catch(()=>{if(active)setGeographyError('Administrative boundaries unavailable')})
    return ()=>{active=false}
  },[adminCountry,adminIndex])
  useEffect(()=>{
    if(areaMode!=='ecoregions'||ecoregions.features.length)return
    let active=true
    geography<RegionCollection>('ecoregions').then(value=>{if(active)setEcoregions(value)})
      .catch(()=>{if(active)setGeographyError('WWF ecoregions unavailable')})
    return ()=>{active=false}
  },[areaMode,ecoregions.features.length])
  useEffect(()=>{
    if(!pinMenu)return
    const close=(event:globalThis.PointerEvent)=>{if(!pinDock.current?.contains(event.target as Node))setPinMenu(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setPinMenu(false)}
    document.addEventListener('pointerdown',close)
    document.addEventListener('keydown',escape)
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape)}
  },[pinMenu])

  const countryList=useMemo(()=>[...countryOptions(),...adminIndex],[adminIndex])
  const ecoList=useMemo(()=>ecoregions.features.map(feature=>feature.properties).sort((a,b)=>a.name.localeCompare(b.name)),[ecoregions])
  const selected=useMemo(()=>{
    if(!region||areaMode==='custom')return undefined
    const collection=region.kind==='eco'?ecoregions:region.kind==='admin'?admins:countries
    return collection.features.find(item=>item.properties.id===region.id)
  },[region,areaMode,ecoregions,admins,countries])
  const boundary=useMemo(()=>areaMode==='custom'&&aoi?.type==='lasso'?areaPolygon(aoi):selected?.geometry,[areaMode,aoi,selected])
  const circle=areaMode==='custom'&&aoi?.type==='circle'?aoi:undefined
  const source=useMemo(()=>observations(focus,boundary,circle),[focus,boundary,circle])
  const history=useMemo(()=>source.history(),[source])
  const viirsDay=dateIndex(viirsStart,firstDate)
  const series=useMemo(()=>history.map((day,index)=>dailyStats(day,pass,index>=viirsDay)),[history,pass,viirsDay])
  const activeIndex=dateIndex(date,firstDate)
  const stats=series[activeIndex]
  const startIndex=dateIndex(from,firstDate), endIndex=dateIndex(to,firstDate)
  const period=useMemo(()=>periodStats(series,startIndex,endIndex,pass,viirsDay),[series,startIndex,endIndex,pass,viirsDay])
  const demoCells=useMemo(()=>source.cellsForDay(date).filter(cell=>pass==='all'||cell.pass===pass),[source,date,pass])
  const estimates=dailyEstimates(stats,harmonized,focus)
  const adjustment=stats.raw?100*(stats.corrected/stats.raw-1):0
  const delta=100*(estimates.frp/focus.median-1)
  const severity=demoCells.length&&delta>130?'critical':demoCells.length&&delta>0?'elevated':'normal'

  const game=useDailyPuzzle(focus.id,hasSelectedDay?date:null,setMessage)
  useEffect(()=>{
    if(!game.open&&!orbiting)updateViewUrl(settings)
  },[game.open,orbiting,settings])
  const historical=historicalApi!==undefined&&!game.open
  const viirs=date>=(historical?snppArchiveStart:viirsStart)
  const activeWeek=weekRange(calendarWeeks[weekIndex(date)],from,to)
  const mapFrom=hasSelectedDay?date:activeWeek.from
  const mapTo=hasSelectedDay?date:activeWeek.to
  const actual=useHistorical(historical,historicalRequest(settings),date,mapFrom,mapTo)
  const cells=useMemo(()=>{
    if(historical)return sumMapCells(actual.mapDays?.map(day=>historicalCells(day.rows,day.date,harmonized))??[])
    return sumMapCells(datesInRange(mapFrom,mapTo).map(day=>source.cellsForDay(day)
      .filter(cell=>pass==='all'||cell.pass===pass)
      .map(cell=>{
        const readings=cellObservations(cell,pass)
        return {...cell,raw:!game.open&&day>=viirsStart?readings.viirsFrp:harmonized?readings.correctedFrp:cell.raw}
      })))
  },[actual.mapDays,game.open,harmonized,historical,mapFrom,mapTo,pass,source])
  const mapCellLimit=20_000
  const mapCells=useMemo(()=>cells.length>mapCellLimit?cells.slice(0,mapCellLimit):cells,[cells])

  const observedDays=useMemo(()=>actual.days?.map(day=>({date:day.date,values:actualDay(day,pass)}))??[],[actual.days,pass])
  const weekStats=useMemo(()=>{
    if(hasSelectedDay)return undefined
    const selectedDays=datesInRange(mapFrom,mapTo)
    const byDate=new Map(observedDays.map(day=>[day.date,day.values]))
    const aggregate=(metric:'count'|'frp')=>summarizeWeek(selectedDays.map(day=>{
      if(historical)return historicalCalendarValue(day,byDate.get(day),metric,harmonized).value
      const values=series[dateIndex(day,firstDate)]
      if(!game.open&&day>=viirsStart)return metric==='count'?values.viirsCount:values.viirs
      if(harmonized)return metric==='count'?values.correctedCount:values.corrected
      return metric==='count'?values.rawCount:values.raw
    }),false)
    return {count:aggregate('count'),frp:aggregate('frp')}
  },[game.open,harmonized,hasSelectedDay,historical,mapFrom,mapTo,observedDays,series])
  const observedPeriod=useMemo(()=>actualPeriod(observedDays.filter(day=>day.date>=from&&day.date<=to),
    endIndex-startIndex+1,pass),[observedDays,from,to,startIndex,endIndex,pass])
  const observedDay=actualDay(actual.day,pass)
  const daily=historical?observedDay:stats
  const totals=historical?observedPeriod.totals:period.totals
  const mean=(field:keyof typeof observedDay)=>{
    const count=historical?observedPeriod.denominators[field]:field.startsWith('viirs')?period.viirsDays:period.days
    const total=totals[field]
    return count&&total!==null?number(total/count):'—'
  }
  const observedAdjustment=observedDay.raw&&observedDay.corrected!==null?100*(observedDay.corrected/observedDay.raw-1):null
  const observedScore=actual.day?.z_score
  const context=useMemo(()=>{
    const field=harmonized?'corrected':'raw'
    const current=observedDay[field]
    const values=observedDays.flatMap(day=>day.values[field]===null?[]:[day.values[field]])
      .sort((a,b)=>a-b)
    if(current===null||!values.length)return undefined
    const middle=Math.floor(values.length/2)
    const median=(values[middle]+values[Math.floor((values.length-1)/2)])/2
    const rank=values.filter(value=>value>current).length+1
    return {median,delta:median>0?100*(current/median-1):null,rank,percentile:100*values.filter(value=>value<=current).length/values.length}
  },[harmonized,observedDay.corrected,observedDay.raw,observedDays])
  const nearestObserved=useMemo(()=>{
    if(!historical||!actual.mapDays||actual.mapDays.some(day=>day.rows.length))return undefined
    const selected=Date.parse(date)
    return observedDays.filter(day=>day.date>=from&&day.date<=to&&(day.values.rawCount!==null||day.values.viirsCount!==null))
      .reduce<string|undefined>((nearest,day)=>
        !nearest||Math.abs(Date.parse(day.date)-selected)<Math.abs(Date.parse(nearest)-selected)?day.date:nearest,undefined)
  },[actual.mapDays,date,from,historical,observedDays,to])
  const calendarDayWhileLoading=actual.days?undefined:actual.day
  const historicalCalendar=useMemo(()=>{
    if(!historical)return undefined
    if(metric==='z'){
      const scores=new Map(actual.days?.map(day=>[day.date,day]))
      const days=archiveDates.map(day=>{
        const row=scores.get(day)
        return {value:row?.z_score??null,source:'MODIS',details:scoreDetails(row)}
      })
      return {raw:days,harmonized:days}
    }
    const byDate=new Map(observedDays.map(day=>[day.date,day.values]))
    if(calendarDayWhileLoading)byDate.set(calendarDayWhileLoading.date,actualDay(calendarDayWhileLoading,pass))
    return {
      raw:archiveDates.map(day=>historicalCalendarValue(day,byDate.get(day),metric,false)),
      harmonized:archiveDates.map(day=>historicalCalendarValue(day,byDate.get(day),metric,true)),
    }
  },[calendarDayWhileLoading,actual.days,observedDays,historical,metric,pass])


  useEffect(()=>{
    if(!playing)return
    if(historical&&!actual.mapDays)return
    const timer=window.setTimeout(()=>setSettings(current=>({...current,date:nextWeekDate(current.date,current.from,current.to)})),460)
    return ()=>clearTimeout(timer)
  },[playing,from,to,date,historical,actual.mapDays])
  useEffect(()=>{
    if(!message)return
    const timer=window.setTimeout(()=>setMessage(''),3200)
    return ()=>clearTimeout(timer)
  },[message])

  function navigateTo(target:CameraDestination,apply:()=>void,globe:boolean,duration:number) {
    if(globe&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      setCommand({globe:target,startedAt:performance.now()})
      startTransition(apply)
    }else{
      apply()
      setCommand({camera:target,duration:globe?0:duration})
    }
  }

  function chooseRegion(next:Region,point?:Coord,globe=false) {
    stopTour(false)
    const nextFocus=focusForRegion(next,date,point)
    const nextMode=next.kind==='eco'?'ecoregions':'countries'
    setTool(null);setOrbiting(false);setPlaying(false)
    const target={lon:nextFocus.center[0],lat:nextFocus.center[1],zoom:nextFocus.zoom}
    navigateTo(target,()=>setSettings(current=>({...current,focus:nextFocus,region:next,areaMode:nextMode,aoi:null,query:next.name})),globe,880)
  }
  function goToPuzzleRegion(puzzle:Puzzle) {
    const next=puzzleFocus(puzzle)
    if(!next)return
    const saved=tour.current?.original
    stopTour(false)
    setPlaying(false)
    setTool(null)
    setSettings(current=>({...(saved??current),focus:next,region:null,areaMode:'countries',aoi:null,query:'',harmonized:false,pass:'all'}))
    setCommand({camera:{lon:next.center[0],lat:next.center[1],zoom:next.zoom},duration:880})
  }
  function selectMapRegion(feature:RegionFeature,point?:Coord) {
    const target=feature.properties
    if(target.kind==='country'&&region?.id===target.id)return
    const entry=target.kind==='country'?countryList.find(item=>item.id===target.id&&item.kind==='country')??target:target
    chooseRegion(entry,entry.kind==='eco'?point:undefined)
  }
  function changeAreaMode(next:AreaMode) {
    stopTour(false)
    setTool(null);setMeasuring(false);setGeographyError('')
    setSettings(current=>({...current,areaMode:next,aoi:next==='custom'?current.aoi:null,
      query:current.areaMode===next?current.query:'',region:next==='custom'||(next==='ecoregions')===(current.region?.kind==='eco')?current.region:null}))
  }
  function selectDate(value:string,recenter=false,daily=true) {
    stopTour(false)
    setPlaying(false)
    setSettings(current=>({...current,date:clampDate(value,current.from,current.to),granularity:daily?'day':undefined}))
    if(recenter){setOrbiting(false);setCommand({camera:{lon:focus.center[0],lat:focus.center[1]},duration:420})}
  }
  function range(start:string,end:string) {
    stopTour(false)
    setSettings(current=>({...current,from:start,to:end,date:clampDate(current.date,start,end),
      granularity:current.date<start||current.date>end?undefined:current.granularity}));setPlaying(false)
  }
  function updateArea(area:Aoi) {
    setSettings(current=>({...current,aoi:area,areaMode:'custom',region:null,radius:area.type==='circle'?area.radius:current.radius}))
    setTool(null)
  }
  function setRadius(value:number) {
    if(!Number.isFinite(value))return
    const next=Math.min(maxCircleRadius,Math.max(.01,value))
    setSettings(current=>current.radius===next?current:{
      ...current,radius:next,aoi:current.aoi?.type==='circle'?{...current.aoi,radius:next}:current.aoi,
    })
  }
  function coordinates(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values=new FormData(event.currentTarget)
    const center:Coord=[Number(values.get('longitude')),Number(values.get('latitude'))]
    const nextRadius=Number(values.get('radius'))
    if(!center.every(Number.isFinite)||!Number.isFinite(nextRadius))return
    updateArea({type:'circle',center,radius:nextRadius})
    const zoom=Math.max(6,focus.zoom)
    setSettings(current=>({...current,focus:{...current.focus,center,zoom}}))
    setCommand({camera:{lon:center[0],lat:center[1],zoom},duration:780})
    setDialog(false)
  }
  function stopTour(restore:boolean) {
    const active=tour.current
    if(!active)return
    tour.current=null
    setOrbiting(false)
    if(restore){
      setSettings(active.original)
      setCommand({camera:active.camera,duration:700})
    }
  }
  function showTourStop(index:number) {
    const active=tour.current
    if(!active)return
    const target=active.stops[index]
    if(!target){stopTour(true);return}
    setTourStop(index+1)
    setSettings(target)
    setCommand({track:cinematicTrack(target.focus,index)})
  }
  function orbit() {
    if(orbiting){stopTour(true);return}
    setMeasuring(false);setTool(null);setPlaying(false)
    const stops=tourRegions.map(entry=>({
      ...settings,focus:entry,region:null,areaMode:'countries' as const,aoi:null,query:'',
      date:entry.date,granularity:undefined,from:entry.date<from?entry.date:from,to:entry.date>to?entry.date:to,
    }))
    tour.current={original:settings,camera:camera.current,stops}
    setOrbiting(true)
    showTourStop(0)
  }
  function savePin(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(!pinName.trim())return
    const next=[...pins,{id:crypto.randomUUID(),name:pinName.trim(),snapshot:{...settings,camera:camera.current}}]
    setPins(next);setPinDialog(false)
    setMessage(writePins(next)?'Pin saved':'Pin saved for this session')
  }
  function deletePin(id:string) {
    const next=pins.filter(pin=>pin.id!==id)
    setPins(next)
    if(!writePins(next))setMessage('Storage unavailable')
  }
  function restorePin(pin:Pin) {
    stopTour(false)
    const snapshot=pin.snapshot
    const restoredFocus=snapshot.region?.kind==='country'?{...snapshot.focus,area:'Country or territory'}:snapshot.focus
    setTool(null);setMeasuring(false);setOrbiting(false);setPlaying(false);setPinMenu(false)
    navigateTo(snapshot.camera,()=>setSettings({...snapshot,focus:restoredFocus}),true,0)
    setMessage('Opened '+pin.name)
  }
  async function exportReport() {
    const selection=actual.selection
    if(historical&&!selection)return
    setExportingReport(true)
    try{
      const report=await import('./statisticalReport')
      if(historical&&selection){
        const params=new URLSearchParams({date,start:from,end:to})
        const response=await historicalFetch('/queries/'+selection.query_id+'/report-data?'+params)
        const observations:HistoricalReport=await response.json()
        await report.exportHistoricalReport(settings,observations,from,to)
      }else{
        await report.exportStatisticalReport({
          settings,day:stats,period,estimates,viirs,adjustment,delta,severity,activeCells:demoCells.length,
          wape:calibrationAccuracy.holdout_daytime_wape_2025,bias:calibrationAccuracy.west_us_bias,
        })
      }
      setMessage('Statistical report exported')
    }catch(error){
      console.error('Statistical report export failed',error)
      setMessage(error instanceof Error ? error.message : 'Could not export the statistical report')
    }finally{
      setExportingReport(false)
    }
  }
  async function exportData(format:'csv'|'geojson') {
    const name='teletraan-1-'+focus.id.replace(/[^a-z0-9-]/gi,'-')+'-'+date
    if(historical){
      const selection=actual.selection
      if(!selection)return
      try{
        const params=new URLSearchParams(gridParams)
        params.set('date',date)
        params.set('format',format)
        const response=await historicalFetch('/queries/'+selection.query_id+'/export?'+params)
        download(name+'.'+format,await response.blob())
        setMessage(format.toUpperCase()+' exported')
      }catch(error){
        setMessage(error instanceof Error ? error.message : 'Could not download the historical export')
      }
      return
    }
    if(!demoCells.length)return
    const values=(cell:Cell)=>{
      const sensors=cellObservations(cell,pass)
      return {date,selected_frp_mw:harmonized?sensors.correctedFrp:cell.raw,harmonized_modis_frp_mw:sensors.correctedFrp,raw_modis_hotspots:sensors.rawCount,harmonized_modis_hotspots:sensors.correctedCount,
        viirs_frp_mw:viirs?sensors.viirsFrp:null,viirs_hotspots:viirs?sensors.viirsCount:null,mode:harmonized?'harmonized':'raw',source:'demo'}
    }
    if(format==='csv'){
      const header='cell_id,date,latitude,longitude,pass,selected_frp_mw,raw_modis_frp_mw,harmonized_modis_frp_mw,raw_modis_hotspots,harmonized_modis_hotspots,viirs_frp_mw,viirs_hotspots,mode,source'
      const rows=demoCells.map(cell=>{
        const v=values(cell)
        return [cell.id,date,cell.center[1].toFixed(6),cell.center[0].toFixed(6),cell.pass,v.selected_frp_mw.toFixed(4),cell.raw.toFixed(4),
          v.harmonized_modis_frp_mw.toFixed(4),v.raw_modis_hotspots,v.harmonized_modis_hotspots.toFixed(4),v.viirs_frp_mw?.toFixed(4),v.viirs_hotspots,v.mode,v.source].join(',')
      })
      download(name+'.csv',[header,...rows].join('\r\n'),'text/csv;charset=utf-8')
    }else{
      const features=demoCells.map(cell=>{const feature=cellPolygon(cell);return {...feature,properties:{...feature.properties,...values(cell)}}})
      download(name+'.geojson',JSON.stringify({type:'FeatureCollection',features},null,2),'application/geo+json')
    }
    setMessage(number(demoCells.length)+' cells exported')
  }

  const displayOptions=areaMode==='ecoregions'?ecoList:countryList
  function queryFilters() {
    return <>
      <div className="panel-header"><span className="section-icon"><SlidersHorizontal size={16}/></span><h2>Query filters</h2></div>
      <div className="query-filter-sections">
        <section className="filter-section">
          <h3><FocusIcon size={14}/>Area of interest <InfoTip label="Area of interest" help="Choose the country, administrative region, ecoregion, or custom area used to filter observations."/></h3>
          <Segmented label="Area of interest" value={areaMode} onChange={changeAreaMode} className="area-mode"
            items={[{value:'countries',label:'Countries'},{value:'ecoregions',label:'Eco-regions'},{value:'custom',label:'Custom Area'}]}/>
          <RegionSearch key={areaMode} query={query} mode={areaMode} options={displayOptions} onQuery={value=>setSettings(current=>({...current,query:value}))} onChoose={next=>chooseRegion(next,undefined,true)}/>
          {areaMode!=='custom'?<>
            <div className="focus-card"><MapPin size={17}/><div><strong>{focus.name}</strong><span>{focus.area}</span></div><Crosshair size={14} className="focus-cross"/></div>
            {areaMode==='countries'&&region?.country&&admins.features.length>0&&<label className="admin-field">
              <span>Administrative region</span><select aria-label="Administrative region" value={region.kind==='admin'?region.id:''}
                onChange={event=>{
                  const id=event.target.value
                  const match=id?admins.features.find(feature=>feature.properties.id===id):undefined
                  const country=countryList.find(entry=>entry.kind==='country'&&entry.id===region.country)
                  if(match)chooseRegion(match.properties,undefined,true)
                  else if(!id&&country)chooseRegion(country,undefined,true)
                }}>
                <option value="">Whole country</option>
                {[...admins.features].sort((a,b)=>a.properties.name.localeCompare(b.properties.name)).map(feature=><option key={feature.properties.id} value={feature.properties.id}>{feature.properties.name}</option>)}
              </select>
            </label>}
            <p className="filter-hint">{geographyError||(areaMode==='ecoregions'?(ecoList.length?'Select an ecoregion on the map or search by name.':'Loading WWF ecoregions…'):'Select a country on the map, then choose a state or province.')}</p>
          </>:<div className="custom-tools">
            <label className="radius-input"><span>Radius</span><RadiusField value={circlePreviewRadius??radius} onChange={setRadius}/><span>km</span></label>
            <div className="custom-buttons">
              <Button aria-pressed={tool==='circle'} onClick={()=>{setMeasuring(false);setTool(tool==='circle'?null:'circle')}}><Circle size={13}/> Radial Circle</Button>
              <Button aria-pressed={tool==='lasso'} onClick={()=>{setMeasuring(false);setTool(tool==='lasso'?null:'lasso')}}><Lasso size={13}/> Freehand Lasso</Button>
              <Button onClick={()=>setDialog(true)}><MapPin size={13}/> Enter Lat/Lon</Button>
              {aoi&&<Button onClick={()=>setSettings(current=>({...current,aoi:null}))}><X size={13}/> Clear Area</Button>}
            </div>
          </div>}
        </section>
        <section className="filter-section orbital-filters">
          <h3>Orbital pass <InfoTip label="Orbital pass" help="Filter detections by whether the satellite observed the area during a daytime or nighttime pass."/></h3>
          <Segmented label="Orbital pass" value={pass} onChange={value=>setSettings(current=>({...current,pass:value}))}
            items={[{value:'all',label:'All Passes'},{value:'day',label:'Day'},{value:'night',label:'Night'}]}/>
          <div className="pass-coefficients mono">
            <div title="Daily FRP uses a separate coefficient for each pass">K_FRP <b>{pass==='all'?(calibration.dailyFrp.day.toFixed(3)+' / '+calibration.dailyFrp.night.toFixed(3)):calibration.dailyFrp[pass].toFixed(3)}</b></div>
            <div>K_COUNT <b>{calibration.hotspots[pass].toFixed(3)}</b></div>
            <p className="period-coefficient">FRP ≥ 7 days <b>{calibration.periodFrp[pass].toFixed(3)}</b></p>
          </div>
        </section>
        <section className="filter-section calibration-controls">
          <h3><Layers3 size={14}/>Intercalibration (before 2012)
            <InfoTip label="Intercalibration" help="For the map and the calendar’s fire power and hotspot counts, Raw Satellite shows original MODIS readings before 2012. Harmonized adjusts MODIS to the VIIRS scale. From 2012 onward, both modes use VIIRS when available and harmonized MODIS when VIIRS has no observations."/>
          </h3>
          <Segmented label="Intercalibration mode" value={harmonized?'harmonized':'raw'} onChange={value=>setSettings(current=>({...current,harmonized:value==='harmonized'}))}
            items={[{value:'raw',label:<><Database size={13}/> Raw Satellite</>},{value:'harmonized',label:<>Harmonized</>}]}/>
        </section>
      </div>
    </>
  }

  return <main className="console">
    <header className="header">
      <div className="brand">
        <div className="brand-icon"><Satellite size={22} strokeWidth={1.65}/><span/></div>
        <div className="brand-copy"><h1>TELETRAAN-1</h1><div className="mono">WILDFIRE MISSION CONTROL</div></div>
      </div>
        <div className="header-tools">
          <Button className="tool-button orbit-trigger" helpDelay={500} help="Start or stop a camera tour of the showcase regions." aria-label="3D Orbit Tour / Fly-Around" aria-pressed={orbiting} onClick={orbit}><CameraIcon size={15}/><span>{orbiting?"Tour "+tourStop+"/"+tour.current?.stops.length:"3D Orbit Tour"}</span></Button>
          <PuzzleDropdown game={game} onRegion={goToPuzzleRegion} trigger={id=><Button className="tool-button puzzle-trigger" aria-label="Daily Puzzle"
            aria-expanded={game.open} aria-controls={game.open?id:undefined} data-solved={game.solved}
            helpDelay={500} help="Open the daily challenge and find the fire activity that matches its clues." onClick={game.toggle}><PuzzleIcon size={15}/><span>Daily Puzzle</span></Button>}/>
          <Button className="tool-button ecosystem-button" helpDelay={500} help="Show or hide peatlands, protected areas, and the Chornobyl Exclusion Zone on the map." aria-label="Peatlands & Protected Areas Overlay" aria-pressed={options.ecosystems}
            onClick={()=>setSettings(current=>({...current,options:{...current.options,ecosystems:!current.options.ecosystems}}))}><Leaf size={15}/><span>Peatlands &amp; Protected Areas</span></Button>
          <Button className="tool-button" helpDelay={500} help="Activate the ruler, then drag between two points on the map to measure the distance." aria-label="Ruler" aria-pressed={measuring} onClick={()=>{setTool(null);setMeasuring(value=>!value)}}><Ruler size={15}/><span>Ruler</span></Button>
          </div>
        <div className="header-pins">
          <Button className="tool-button" helpDelay={500} help="Save the current map view, date range, and filters as a pin." aria-label="Save pin" onClick={()=>{setPinMenu(false);setPinName('');setPinDialog(true)}}><BookmarkPlus size={15}/></Button>
          <div className="pin-dock" ref={pinDock}>
            <Button className="tool-button" helpDelay={500} help="Open your saved views and the built-in scenarios." aria-label="Open saved pins" aria-expanded={pinMenu} onClick={()=>setPinMenu(value=>!value)}><Bookmark size={15}/><span>Pins</span></Button>
            {pinMenu&&<div className="pin-list" aria-label="Saved pins">
              {pins.length?pins.map(pin=><div className="pin-row" key={pin.id}>
                <button type="button" onClick={()=>restorePin(pin)}>{pin.name}</button>
                <button type="button" className="pin-delete" aria-label={'Delete pin '+pin.name} title={'Delete '+pin.name} onClick={()=>deletePin(pin.id)}><X size={14}/></button>
              </div>):<p>No saved pins</p>}
            </div>}
          </div>

          <UtcClock/>
        </div>
    </header>

    <div className="mission-workspace">
    <div className="workbench" data-filters-open={filtersOpen} data-analytics-open={analyticsOpen}>
      <aside className="filters" id="query-filters" aria-label="Query filters" hidden={!filtersOpen}>{queryFilters()}</aside>
      <Button className="panel-toggle panel-toggle-left" aria-expanded={filtersOpen} aria-controls="query-filters"
        aria-label={filtersOpen?'Hide query filters':'Show query filters'} onClick={()=>{
          if(!filtersOpen&&window.matchMedia(narrowWorkbench).matches)setAnalyticsOpen(false)
          setFiltersOpen(!filtersOpen)
        }}>
        {filtersOpen?<ChevronLeft size={18}/>:<ChevronRight size={18}/>}
      </Button>

      <MapStage focus={focus} date={date} cells={mapCells} historical={historical} weekly={!hasSelectedDay} aoi={aoi} tool={tool} onArea={updateArea} onCirclePreviewRadius={setCirclePreviewRadius}
        command={command} onCamera={value=>{camera.current=value}} options={options} onOptions={next=>setSettings(current=>({...current,options:next}))}
        countries={countries} admins={admins} ecoregions={ecoregions} areaMode={areaMode} selected={selected} onRegion={selectMapRegion}
        measuring={measuring} orbiting={orbiting} onTourEnd={()=>showTourStop(tourStop)}/>

      <Button className="panel-toggle panel-toggle-right" aria-expanded={analyticsOpen} aria-controls="analytics-panel"
        aria-label={analyticsOpen?'Hide analytics':'Show analytics'} onClick={()=>{
          if(!analyticsOpen&&window.matchMedia(narrowWorkbench).matches)setFiltersOpen(false)
          setAnalyticsOpen(!analyticsOpen)
        }}>
        {analyticsOpen?<ChevronRight size={18}/>:<ChevronLeft size={18}/>}
      </Button>
      <aside className="analytics" id="analytics-panel" aria-label="Analytics and export" hidden={!analyticsOpen}>
        <div className="panel-header"><span className="section-icon"><Activity size={16}/></span><h2>Analytics &amp; export</h2></div>
        <div className="accuracy-wrap"><span className="accuracy mono" title="Validation metrics for the calibration benchmark"><Activity size={13}/> WAPE {calibrationAccuracy.holdout_daytime_wape_2025} <i/> BIAS {calibrationAccuracy.west_us_bias}</span></div>
        <div className="analytics-scroll">
          <div className="analysis-heading">
            <div className="analysis-area"><MapPin size={13}/>{focus.area}</div>
            <h3>{focus.name}</h3>
            <div className="analysis-date mono"><span>{hasSelectedDay?<>
              {prettyDate(date)} <b>· DOY {String(doy(date)).padStart(3,'0')}</b>
            </>:mapFrom+' – '+mapTo}</span>
              <span className={'severity '+(historical?'normal':severity)}><span/>{!hasSelectedDay?'WEEKLY TOTAL':historical?(daily.rawCount!==null||daily.viirsCount!==null?'OBSERVED':actual.day?'COVERAGE UNKNOWN':'LOADING'):severity==='critical'?'CRITICAL ANOMALY':severity==='elevated'?'ELEVATED':'NOMINAL'}</span></div>
          </div>
          {historical&&actual.error&&<p className="sensor-note" role="alert">{actual.error} <Button onClick={actual.retry}>Retry</Button></p>}
          {historical&&!actual.days&&!actual.error&&<p className="sensor-note" role="status">Loading the 2000–2025 archive…</p>}
          {historical&&actual.mapDays?.every(day=>day.rows.length===0)&&actual.days&&<p className="sensor-note">No detections in this area for {hasSelectedDay?date:mapFrom+' – '+mapTo} and the selected pass.
            {nearestObserved&&<> <Button onClick={()=>selectDate(nearestObserved,true)}>Go to {nearestObserved}</Button></>}
          </p>}
          {(actual.complete===false||cells.length>mapCellLimit)&&<p className="sensor-note">Map display limit reached. Calendar totals still use the full available archive.</p>}
          <section className="analysis-card calibration">
            <h4><Layers3 size={14}/> Scientific intercalibration <InfoTip label="Hotspots" help={hotspotHelp}/><InfoTip label="FRP" help={frpHelp}/></h4>
            {weekStats?<><div className="sensor-group">Selected week</div>
              <SensorRow label="Hotspot sum" value={display(weekStats.count.value)}/>
              <SensorRow label="FRP sum" value={display(weekStats.frp.value)} unit="MW"/>
              <p className="sensor-note">{weekStats.count.observed}/{weekStats.count.days} days with hotspot values · {weekStats.frp.observed}/{weekStats.frp.days} days with FRP values</p>
            </>:<>
            <div className="sensor-group">Selected day · {date}</div>
            <SensorRow label="Raw MODIS hotspots" value={display(daily.rawCount)} active={!harmonized}/>
            <SensorRow label="Harmonized MODIS hotspots" value={display(daily.correctedCount)} active={harmonized}/>
            {viirs&&<SensorRow label="VIIRS hotspots" value={display(daily.viirsCount)}/>}
            <SensorRow label="Raw MODIS FRP" value={display(daily.raw)} unit="MW" active={!harmonized}/>
            <SensorRow label="Harmonized MODIS FRP" value={display(daily.corrected)} unit="MW" active={harmonized}/>
            {viirs&&<SensorRow label="VIIRS FRP" value={display(daily.viirs)} unit="MW"/>}
            <div className="correction mono"><ArrowDown size={13}/><b>{display(historical?observedAdjustment:adjustment,value=>value.toFixed(1)+'%')}</b><span>daily FRP adjustment</span></div>
            {historical&&<p className="sensor-note">Harmonized values are estimates using the configured coefficients.</p>}
            </>}
            <div className="sensor-group period-group">Period totals <span>{period.days} {period.days===1?'DAY':'DAYS'}</span></div>
            <SensorRow label="Raw MODIS hotspots" value={display(totals.rawCount)}/>
            <SensorRow label="Harmonized MODIS hotspots" value={display(totals.correctedCount)} active={harmonized}/>
            {period.viirsDays>0&&<SensorRow label="VIIRS hotspots" value={display(totals.viirsCount)}/>}
            <SensorRow label="Raw MODIS FRP sum" value={display(totals.raw)} unit={historical?'MW':'MW·day'}/>
            <SensorRow label="Harmonized MODIS FRP sum" value={display(totals.corrected)} unit={historical?'MW':'MW·day'} active={harmonized}/>
            {period.viirsDays>0&&<SensorRow label="VIIRS FRP sum" value={display(totals.viirs)} unit={historical?'MW':'MW·day'}/>}
            <div className="sensor-group period-group">Daily averages <span>{period.usePeriodCoefficient?'PERIOD FRP':'DAILY FRP'}</span></div>
            <SensorRow label="Raw MODIS hotspots" value={mean('rawCount')} unit="/day"/>
            <SensorRow label="Harmonized MODIS hotspots" value={mean('correctedCount')} unit="/day" active={harmonized}/>
            {period.viirsDays>0&&<SensorRow label="VIIRS hotspots" value={mean('viirsCount')} unit="/day"/>}
            <SensorRow label="Raw MODIS FRP" value={mean('raw')} unit="MW"/>
            <SensorRow label="Harmonized MODIS FRP" value={mean('corrected')} unit="MW" active={harmonized}/>
            {period.viirsDays>0&&<SensorRow label="VIIRS FRP" value={mean('viirs')} unit="MW"/>}
            {historical?<p className="sensor-note">Averages use days with available values for each metric. FRP days: MODIS {fmt(observedPeriod.denominators.raw)}, VIIRS {fmt(observedPeriod.denominators.viirs)}.</p>:
              period.viirsDays>0&&period.viirsDays<period.days&&<p className="sensor-note">VIIRS averages cover {fmt(period.viirsDays)} days from 2012 onward.</p>}
            <div className="sensor-group period-group">Activity in selected period</div>
            <SensorRow label="Days with detections" value={historical?display(actual.days?observedPeriod.activeDays:null):fmt(period.activeDays)} unit={'/ '+fmt(period.days)}/>
            <SensorRow label="Peak harmonized FRP day" value={historical?observedPeriod.peak?.date??'—':period.peak?archiveDates[period.peakDay]:'—'}
              unit={historical?(observedPeriod.peak?display(observedPeriod.peak.values.corrected)+' MW':undefined):period.peak?fmt(period.peak)+' MW':undefined}/>
          </section>
          {hasSelectedDay&&<section className="analysis-card historical">
            <h4><Clock3 size={14}/> Historical context <InfoTip label="Z-score" help={zScoreHelp}/></h4>
            {historical?<>
              <div className="historical-row"><span><strong className="mono">{display(context?.delta,signed)}</strong> vs historical median</span><small className="mono">{display(context?.median)} MW BASELINE</small></div>
              <div className="historical-row"><span><strong className="mono">{display(context?.rank,value=>'#'+fmt(value))}</strong> FRP rank <small className="inline-meta">/ observed days</small></span><small className="mono">{context?context.percentile.toFixed(1)+'TH PERCENTILE':'—'}</small></div>
              <div className="historical-row" title={scoreDetails(actual.day)}>
                <span><strong className="mono">{display(observedScore,value=>value.toFixed(2))}</strong> Z-score</span><small className="mono">OBSERVED DAYS</small></div>
            </>:<>
              <div className="historical-row"><span><strong className="mono">{signed(delta)}</strong> vs historical median</span><small className="mono">{number(focus.median)} MW BASELINE</small></div>
              <div className="historical-row"><span><strong className="mono">{cells.length?'#'+focus.rank:'—'}</strong> severity rank <small className="inline-meta">/ 26 years</small></span><small className="mono">{cells.length?focus.percentile.toFixed(1)+'TH PERCENTILE':'NO ACTIVE CELLS'}</small></div>
            </>}
          </section>}
          <div className="kpis">
            <section><span><Grid2X2 size={13}/> Active fire cells <InfoTip label="Active fire cells" help="Number of map grid cells containing fire detections for the selected week or day."/></span><strong className="mono">{historical&&!actual.mapDays?'—':units(cells.length,'cells')}</strong></section>
            {hasSelectedDay&&<><section title={historical?'Requires time integration of FRP':undefined}><span><Zap size={13}/> Radiative energy <InfoTip label="Radiative energy" help="Fire radiative energy is the total energy radiated over time. It is estimated by integrating FRP."/></span><strong className="mono">{historical?'—':units(estimates.fre,'TJ')}</strong></section>
            <section className="wide-kpi" title={historical?'Requires a validated area estimate':'FRP ÷ [0.95 × σ × (800⁴ − 300⁴)], expressed in km²'}><span><FocusIcon size={13}/> Estimated fire area</span><strong className="mono">{historical?'—':units(estimates.area,'km²')}</strong></section>
            <section className="wide-kpi" title={historical?'Requires time integration and an emissions model':'FRE × 0.368 kg dry matter/MJ × 1.626 kg CO₂/kg dry matter'}><span><Leaf size={13}/> Estimated CO₂ emissions</span><strong className="mono">{historical?'—':units(estimates.co2,'t')}</strong></section></>}
          </div>
        </div>
        <div className="export-buttons">
          <Button className="csv-button" title={'Export observations for '+date} disabled={historical?!actual.selection:!demoCells.length} onClick={()=>exportData('csv')}><ArrowDownToLine size={15}/> Download Filtered CSV<ArrowUpRight size={13} className="button-tail"/></Button>
          <Button className="geojson-button" title={'Export observations for '+date} disabled={historical?!actual.selection:!demoCells.length} onClick={()=>exportData('geojson')}><CodeXml size={15}/> Export GeoJSON for QGIS<ArrowUpRight size={13} className="button-tail"/></Button>
          <Button className="pdf-button" disabled={exportingReport||(historical&&!actual.selection)} onClick={exportReport}><FileText size={15}/> {exportingReport?'Preparing PDF…':'Export Statistical Report (PDF)'}<ArrowUpRight size={13} className="button-tail"/></Button>
        </div>
      </aside>
    </div>

    <Timeline date={date} daySelected={hasSelectedDay} puzzleMode={game.open} from={from} to={to} playing={playing}
      onPlay={()=>{stopTour(false);setSettings(current=>({...current,granularity:undefined}));setPlaying(value=>!value)}}
      onDay={value=>selectDate(value,true)} onWeek={value=>selectDate(value,false,false)} series={series} historicalCalendar={historicalCalendar} historyReady={Boolean(actual.days)} harmonized={harmonized} onRange={range} metric={metric} view={calendarView}
      onMetric={value=>setSettings(current=>({...current,metric:value}))} onView={value=>setSettings(current=>({...current,calendarView:value}))}/>
    </div>
    <footer className="footer mono"><span><span className="live-dot"/> {historical?'HISTORICAL TELEMETRY':'DEMO TELEMETRY'} <i/> KEPLER.GL</span><span><TriangleAlert size={12}/> {historical?'NASA FIRMS OBSERVATIONS':'SYNTHETIC FIRE OBSERVATIONS'}</span></footer>
    {message&&<div className="toast" role="status">{message}</div>}

    <Dialog.Root open={dialog} onOpenChange={setDialog}>
      <Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="modal">
        <Dialog.Title><MapPin size={19}/> Enter coordinates</Dialog.Title>
        <Dialog.Description>Set the center and radius of your area of interest.</Dialog.Description>
        <form onSubmit={coordinates}>
          <div className="modal-coordinates">
            <label>Latitude<input type="number" name="latitude" required min="-80" max="80" step="any" defaultValue={focus.center[1]}/></label>
            <label>Longitude<input type="number" name="longitude" required min="-180" max="180" step="any" defaultValue={focus.center[0]}/></label>
          </div>
          <label>Radius (km)<input type="number" name="radius" required min=".01" max={maxCircleRadius} step="any" defaultValue={radius}/></label>
          <Button type="submit" className="csv-button"><Crosshair size={16}/> Apply coordinates</Button>
        </form>
        <Dialog.Close asChild><Button className="modal-close" aria-label="Close coordinates dialog"><X size={18}/></Button></Dialog.Close>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={pinDialog} onOpenChange={setPinDialog}>
      <Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="modal">
        <Dialog.Title><BookmarkPlus size={19}/> Save pin</Dialog.Title>
        <Dialog.Description>Save the current search, filters and map view.</Dialog.Description>
        <form onSubmit={savePin}>
          <label>Pin name<input type="text" required value={pinName} maxLength={70} onChange={event=>setPinName(event.target.value)}/></label>
          <div className="pin-form-actions"><Dialog.Close asChild><Button>Cancel</Button></Dialog.Close><Button type="submit" className="csv-button" disabled={!pinName.trim()}>Save pin</Button></div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </main>
}
