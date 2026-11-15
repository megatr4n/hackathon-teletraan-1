import { CalendarDays, ChartNoAxesCombined, ChevronDown, Grid3X3, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { DAY, firstDate, iso, lastDate, prettyDate, clampDate } from './data'
import { archiveDates } from './observations'
import { calendarWeeks, summarizeWeek, weekIndex, weekRange, weeksByYear, type CalendarWeek } from './calendarWeeks'
import { dateIndex, viirsStart, type DailyStats } from './estimates'
import { Button, InfoTip, Segmented, frpHelp, hotspotHelp, zScoreHelp } from './ui'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { CalendarView, Metric } from './pins'
import { activityColors, calendarActivityScale, frpActivityColor, missingActivityColor, noActivityColor } from './calendarScale'

const weekColumns=Array.from({length:14},(_,index)=>4*index)
const palette=['#1b2630','#29353d','#443338','#663a35','#954832','#c86638','#ef8f4b','#ffc575']
const observedPalette=['#1b2630','#705047','#875443','#a05e47','#b96c44','#d2804c','#ef9a57','#ffc575']
const belowBaselinePalette=['#1b2630','#355268','#3d6581','#467b9c','#4e94b6','#60a9cc','#7abfe1','#a7d9f3']
const restingCalendarHeight=144
const collapsedCalendar=-restingCalendarHeight
const metricHelp={frp:frpHelp,count:hotspotHelp,z:zScoreHelp}
const metricLabels = {frp:'FRP',count:'Hotspot Count',z:'Z-Score'}
type HistoricalDay = { value:number|null; source:string; details?:string }
type HistoricalCalendar = { raw:HistoricalDay[]; harmonized:HistoricalDay[] }
function DateField({label,value,min,max,onChange}:{label:string;value:string;min:string;max:string;onChange:(value:string)=>void}) {
  return <label className="date-field"><span>{label}</span><div><b className="mono">{value}</b>
    <input aria-label={label+' date'} type="date" value={value} min={min} max={max}
      onChange={event=>{if(event.target.value)onChange(event.target.value)}}/>
    <ChevronDown size={12} className="date-chevron"/></div></label>
}
export function DateRangeFields({from,to,onRange}:{from:string;to:string;onRange:(from:string,to:string)=>void}) {
  return <div className="date-grid">
    <DateField label="From" min={firstDate} max={to} value={from} onChange={start=>onRange(clampDate(start,firstDate,to),to)}/>
    <DateField label="To" min={from} max={lastDate} value={to} onChange={end=>onRange(from,clampDate(end,from,lastDate))}/>
  </div>
}
function MetricPicker({metric,onMetric}:{metric:Metric;onMetric:(metric:Metric)=>void}) {
  const [open,setOpen]=useState(false)
  const container=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(!open)return
    const close=(event:PointerEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',close)
    return ()=>document.removeEventListener('pointerdown',close)
  },[open])
  return <div className="metric-picker" ref={container} onKeyDown={event=>{if(event.key==='Escape')setOpen(false)}}>
    <Button className="metric-trigger" aria-label={'Calendar metric: '+metricLabels[metric]} aria-expanded={open}
      onClick={()=>setOpen(value=>!value)}>{metricLabels[metric]}<ChevronDown size={13}/></Button>
    {open&&<div className="metric-options" role="group" aria-label="Calendar metrics">
      {(Object.entries(metricLabels) as [Metric,string][]).map(([id,label])=><button key={id} type="button" aria-pressed={metric===id}
        onClick={()=>{onMetric(id);setOpen(false)}}>{label}</button>)}
    </div>}
  </div>
}

type WeekReading=ReturnType<typeof summarizeWeek>
type FrpComparison={raw:number|null;adjusted:number|null}

function readWeek(values:(number|null)[],range:{from:string;to:string},peak=false){
  return summarizeWeek(range.from<=range.to?
    values.slice(dateIndex(range.from,firstDate),dateIndex(range.to,firstDate)+1):[],peak)
}

function frpDifference(comparison:FrpComparison|undefined){
  if(!comparison||comparison.raw===null||comparison.adjusted===null)return null
  return comparison.adjusted-comparison.raw
}

function paint(value:number|null,heat:number,metric:Metric,historical:boolean) {
  const index=Math.min(7,Math.floor(heat*8))
  if(metric==='z')return historical?(value!==null&&value<0?belowBaselinePalette:observedPalette)[index]:palette[index]
  if(value===null)return missingActivityColor
  if(value===0)return noActivityColor
  return metric==='frp'?frpActivityColor(heat):activityColors[index]
}

function weekLabel(range:{from:string;to:string},reading:WeekReading,metric:Metric,comparison?:FrpComparison) {
  const name=metric==='z'?'Peak daily Z-score':metric==='count'?'Hotspot sum':'FRP sum'
  const unit=metric==='count'?' hotspots':metric==='frp'?' MW':''
  const value=reading.value===null?'No observed value':formatBand(reading.value)+unit
  const summary=range.from+' – '+range.to+' · '+name+' · '+value+' · '+reading.observed+'/'+reading.days+' days with values'
  const delta=frpDifference(comparison)
  if(!comparison||delta===null||comparison.raw===null||comparison.adjusted===null)return summary
  const change=comparison.raw>0?(100*delta/comparison.raw).toFixed(1)+'%':formatBand(delta)+' MW'
  return summary+' · Raw '+formatBand(comparison.raw)+' MW · Harmonized '+formatBand(comparison.adjusted)+' MW · Δ '+(delta>0?'+':'')+change
}

const formatBand=(amount:number)=>amount.toLocaleString('en-US',{maximumFractionDigits:2})

function CalendarScaleLegend({scale,metric,harmonized}:{scale:NonNullable<ReturnType<typeof calendarActivityScale>>;metric:Metric;harmonized:boolean}) {
  const unit=metric==='count'?'hotspots':'MW'
  return <div className="calendar-scale" role="group" aria-label={'Shared calendar color scale in '+unit}>
    <strong className="calendar-scale-mode">{harmonized?'Harmonized':'Raw Satellite'}</strong>
    <span className="calendar-scale-key" title="No observation"><i style={{background:missingActivityColor}}/>∅</span>
    <span className="calendar-scale-key" title="Observed zero"><i style={{background:noActivityColor}}/>0</span>
    <div className="calendar-scale-ramp">
      {scale.lowerBounds.map((lower,index)=>{
        const upper=scale.lowerBounds[index+1]
        if(upper===lower)return null
        const label=upper===undefined?'≥ '+formatBand(lower):lower===0?'> 0 and < '+formatBand(upper):
          formatBand(lower)+' to < '+formatBand(upper)
        const color=activityColors[index]
        const background=metric==='frp'&&upper!==undefined?
          'linear-gradient(to right, '+color+', '+activityColors[index+1]+')':color
        return <i key={index} style={{background}} title={label+' '+unit}/>
      })}
    </div>
    <span>≥ {formatBand(scale.lowerBounds[scale.lowerBounds.length-1])} {unit}</span>
    <InfoTip label="Calendar color scale" help={(metric==='frp'?'Weekly FRP uses logarithmic interpolation between positive percentile breaks. ':'Hotspot counts use discrete percentile bands. ')+
      'Both modes share a scale computed from their positive values across this area and orbital pass. Hover a week for its total in the original units. Open the week to see daily values.'}/>
  </div>
}

export function Timeline({date,daySelected,puzzleMode,from,to,playing,onPlay,onDay,onWeek,series,historicalCalendar,historyReady,harmonized,onRange,metric,view,onMetric,onView}:{
  date:string;daySelected:boolean;puzzleMode:boolean;from:string;to:string;playing:boolean;onPlay:()=>void;onDay:(date:string)=>void;onWeek:(date:string)=>void;
  series:DailyStats[];harmonized:boolean;onRange:(from:string,to:string)=>void;metric:Metric;view:CalendarView;
  onMetric:(metric:Metric)=>void;onView:(view:CalendarView)=>void
  historicalCalendar?:HistoricalCalendar
  historyReady?:boolean
}) {
  const panel=useRef<HTMLElement>(null)
  const details=useRef<HTMLElement>(null)
  const opener=useRef<HTMLButtonElement|null>(null)
  const [openWeek,setOpenWeek]=useState<number|null>(null)
  useEffect(()=>{
    if(openWeek===null)return
    const close=(event:PointerEvent)=>{
      const target=event.target
      if(target instanceof Element&&!details.current?.contains(target)&&!target.closest('.calendar-week'))setOpenWeek(null)
    }
    document.addEventListener('pointerdown',close)
    return ()=>document.removeEventListener('pointerdown',close)
  },[openWeek])
  function closeWeek() {
    setOpenWeek(null)
    opener.current?.focus()
  }
  const drag=useRef<{pointerId:number;y:number;overlap:number}|null>(null)
  const [overlap,setOverlap]=useState(0)
  const [limit,setLimit]=useState(0)
  useLayoutEffect(()=>{
    const pane=panel.current?.parentElement
    const workbench=panel.current?.previousElementSibling
    if(!workbench)return
    const observer=new ResizeObserver(()=>{
      const extension=Math.max(0,-(parseFloat(pane?.style.getPropertyValue('--calendar-overlap')??'')||0))
      // The calendar can cover the side panels while the map keeps a usable viewport.
      const max=Math.max(0,Math.min(480,workbench.clientHeight-extension-245))
      setLimit(max)
      setOverlap(current=>Math.min(current,max))
    })
    observer.observe(workbench)
    return ()=>observer.disconnect()
  },[])
  useLayoutEffect(()=>{
    const pane=panel.current?.parentElement
    pane?.style.setProperty('--calendar-resting-height',restingCalendarHeight+'px')
    pane?.style.setProperty('--calendar-overlap',overlap+'px')
  },[overlap])

  function startResize(event:ReactPointerEvent<HTMLDivElement>) {
    if(event.button!==0||!(event.target instanceof Element)||
      !event.target.closest('.calendar-drag-handle,.timeline-title'))return
    drag.current={pointerId:event.pointerId,y:event.clientY,overlap}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function resize(event:ReactPointerEvent<HTMLDivElement>) {
    const start=drag.current
    if(start?.pointerId===event.pointerId)setOverlap(Math.min(limit,Math.max(collapsedCalendar,start.overlap+start.y-event.clientY)))
  }
  function resizeWithKeyboard(event:KeyboardEvent<HTMLDivElement>) {
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return
    event.preventDefault()
    setOverlap(current=>event.key==='Home'?collapsedCalendar:event.key==='End'?limit:
      Math.min(limit,Math.max(collapsedCalendar,current+(event.key==='ArrowUp'?24:-24))))
  }

  const historicalDays=historicalCalendar?.[harmonized?'harmonized':'raw']
  const historical=historicalDays!==undefined
  const min=weekIndex(from),max=weekIndex(to),value=weekIndex(date)
  const rangeFor=(week:CalendarWeek)=>weekRange(week,from,to)
  function chooseWeek(index:number,button?:HTMLButtonElement) {
    if(index<min||index>max)return
    onWeek(rangeFor(calendarWeeks[index]).from)
    if(button){
      opener.current=button
      setOpenWeek(index)
    }else setOpenWeek(null)
  }
  const activity=useMemo(()=>{
    if(metric==='z')return undefined
    const count=metric==='count'
    const demoValues=(adjusted:boolean)=>series.map((day,index)=>!puzzleMode&&archiveDates[index]>=viirsStart?
      (count?day.viirsCount:day.viirs):adjusted?(count?day.correctedCount:day.corrected):(count?day.rawCount:day.raw))
    const raw=historicalCalendar?.raw.map(day=>day.value)??demoValues(false)
    const adjusted=historicalCalendar?.harmonized.map(day=>day.value)??demoValues(true)
    const totals=(values:(number|null)[])=>calendarWeeks.map(week=>summarizeWeek(
      values.slice(dateIndex(week.from,firstDate),dateIndex(week.to,firstDate)+1),false).value)
    return {raw,adjusted,dayScale:calendarActivityScale(raw,adjusted,metric),
      weekScale:calendarActivityScale(totals(raw),totals(adjusted),metric,true)}
  },[series,metric,historicalCalendar,puzzleMode])
  const values=useMemo(()=>{
    if(activity)return harmonized?activity.adjusted:activity.raw
    if(historicalDays)return historicalDays.map(day=>day.value)
    const powers=series.map((day,index)=>!puzzleMode&&archiveDates[index]>=viirsStart?day.viirs:harmonized?day.corrected:day.raw)
    const mean=powers.reduce((a,b)=>a+b,0)/powers.length
    const deviation=Math.sqrt(powers.reduce((sum,power)=>sum+(power-mean)**2,0)/powers.length)||1
    return powers.map(power=>(power-mean)/deviation)
  },[series,activity,harmonized,historicalDays,puzzleMode])
  const weekly=useMemo(()=>calendarWeeks.map(week=>readWeek(values,weekRange(week,from,to),metric==='z')),
    [from,to,metric,values])
  const frpComparisons=useMemo(()=>metric==='frp'&&activity?calendarWeeks.map(week=>{
    const range=weekRange(week,from,to)
    return {raw:readWeek(activity.raw,range).value,adjusted:readWeek(activity.adjusted,range).value}
  }):undefined,[activity,from,to,metric])
  const zCeiling=useMemo(()=>{
    if(metric!=='z')return 1
    const magnitudes=values.flatMap(value=>value===null?[]:[Math.abs(value)]).sort((a,b)=>a-b)
    return Math.log1p(Math.max(1,magnitudes[Math.floor((magnitudes.length-1)*.95)]??0))
  },[metric,values])
  const getHeat=(reading:number|null,week:boolean)=>{
    if(reading===null)return 0
    if(metric==='z')return Math.min(1,.125+.875*Math.log1p(Math.abs(reading))/zCeiling)
    return (week?activity?.weekScale:activity?.dayScale)?.heat(reading)??0
  }
  const shownWeek=openWeek!==null&&openWeek>=min&&openWeek<=max?calendarWeeks[openWeek]:undefined
  const selection=rangeFor(calendarWeeks[value])
  return <section ref={panel} className="timeline" aria-label="Burning activity calendar"
    onKeyDown={event=>{if(event.key==='Escape'&&shownWeek){event.preventDefault();closeWeek()}}}>
    <div className="timeline-top compact-timeline" onPointerDown={startResize} onPointerMove={resize}
      onLostPointerCapture={()=>{drag.current=null}}>
      <div className="calendar-drag-handle" role="separator" aria-label="Resize calendar" aria-orientation="horizontal"
        aria-valuemin={collapsedCalendar} aria-valuemax={limit} aria-valuenow={overlap}
        aria-valuetext={overlap===collapsedCalendar?'Calendar collapsed':undefined} tabIndex={0} onKeyDown={resizeWithKeyboard}/>
      <div className="timeline-title"><span className="section-icon"><CalendarDays size={16}/></span><div><h2>Burning activity calendar</h2><span className="mono">2000–2025 ARCHIVE</span></div></div>
      <DateRangeFields from={from} to={to} onRange={onRange}/>
      <div className="timeline-player">
        <div className="timeline-controls">
          <Button aria-label="Previous week" title="Previous week" onClick={()=>chooseWeek(value-1)}><SkipBack size={14}/></Button>
          <Button aria-label={playing?'Pause timeline':'Play timeline'} title={playing?'Pause timeline':'Play timeline'} className="play-button" onClick={()=>{setOpenWeek(null);onPlay()}}>{playing?<Pause size={15}/>:<Play size={15}/>}</Button>
          <Button aria-label="Next week" title="Next week" onClick={()=>chooseWeek(value+1)}><SkipForward size={14}/></Button>
          <input aria-label="Scrub through weeks" aria-valuetext={selection.from+' – '+selection.to} type="range" min={min} max={max} step={1} value={value}
            style={{'--progress':(max===min?0:100*(value-min)/(max-min))+'%'} as CSSProperties} onChange={event=>chooseWeek(Number(event.target.value))}/>
          <span className="timeline-date mono">{daySelected?prettyDate(date):selection.from+' – '+selection.to}</span>
        </div>
        <div className="timeline-note">
          {view==='grid'&&activity?.weekScale&&<CalendarScaleLegend scale={activity.weekScale} metric={metric} harmonized={harmonized}/>}
          <p>{historical&&!historyReady?'Loading archive values…':metric==='z'?
            'Each week shows the daily Z-score farthest from zero. Blue is below baseline.':
            'Monday–Sunday totals. Hover for coverage, or open a week to select a day.'}</p>
          {metric==='frp'&&view==='grid'&&harmonized&&<div className="frp-adjustment-key">
            <span>Blue edge · lower FRP</span><span>Amber edge · higher FRP</span>
          </div>}
        </div>
      </div>
      <div className="timeline-view">
        <MetricPicker metric={metric} onMetric={onMetric}/>
        <InfoTip label={metricLabels[metric]} help={metricHelp[metric]}/>
        <Segmented label="Calendar view" value={view} onChange={onView} items={[{value:'grid',label:<><Grid3X3 size={13}/> Grid Matrix</>},{value:'ridge',label:<><ChartNoAxesCombined size={14}/> Ridge Waves</>}]}/>
      </div>
    </div>
    {shownWeek&&overlap!==collapsedCalendar&&<section ref={details} className="week-details" role="dialog" aria-label="Week details">
      <div className="week-details-header">
        <strong>{weekLabel(rangeFor(shownWeek),weekly[shownWeek.index],metric,frpComparisons?.[shownWeek.index])}</strong>
        <Button aria-label="Close week" onClick={closeWeek}><X size={14}/></Button>
      </div>
      <div className="week-days">
        {Array.from({length:7},(_,i)=>{
          const day=iso(Date.parse(shownWeek.monday)+i*DAY)
          const enabled=day>=from&&day<=to
          const index=dateIndex(day,firstDate)
          const reading=enabled?values[index]:null
          const source=historicalDays?.[index]
          const unit=metric==='count'?' hotspots':metric==='frp'?' MW':''
          const title='Day '+(i+1)+' · '+day+' · '+(!enabled?'Outside selected dates':reading===null?
            (source?.details??'No observed value'):formatBand(reading)+unit+(source?' · '+source.source:''))
          return <div key={day} className="week-day">
            <span>Day {i+1}</span>
            <button type="button" data-date={day} aria-label={title} title={title} disabled={!enabled} aria-pressed={daySelected&&date===day}
              style={{backgroundColor:paint(reading,getHeat(reading,false),metric,historical)}} onClick={()=>onDay(day)}/>
          </div>
        })}
      </div>
      {metric!=='z'&&<small>Daily colors use a separate daily scale.</small>}
    </section>}
    <div className="daily-calendar" hidden={overlap===collapsedCalendar} tabIndex={0} aria-label="Weekly archive, 2000 to 2025"
      onKeyDown={event=>{
        if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return
        event.preventDefault()
        chooseWeek(value+(event.key==='ArrowLeft'?-1:1))
      }}>
      <div className="weekly-calendar-inner">
        <div className="week-columns mono"><span>YEAR</span>{weekColumns.map(column=><span key={column}
          style={{gridColumn:column+2}}>W{String(column+1).padStart(2,'0')}</span>)}</div>
        {weeksByYear.map(({year,weeks})=><div className={'weekly-year '+(weeks.some(week=>week.index===value)?'selected-year':'')} key={year} data-year={year}>
          <span className="year mono">{year}</span>
          {view==='ridge'&&<svg className="weekly-ridge" viewBox="0 0 53 16" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={'0,16 '+weeks.map((week,i)=>(i+.5)+','+(16-15*getHeat(weekly[week.index].value,true))).join(' ')+' '+weeks.length+',16'}
              fill="#bb75475c" stroke="#f3935b" strokeWidth=".35"/>
          </svg>}
          {weeks.map((week,column)=>{
            const reading=weekly[week.index]
            const disabled=week.index<min||week.index>max
            const comparison=frpComparisons?.[week.index]
            const delta=frpDifference(comparison)
            const adjustment=harmonized&&view==='grid'&&!disabled&&delta!==null&&Math.abs(delta)>=.005?
              (delta<0?'lower':'higher'):undefined
            const title=disabled?week.from+' – '+week.to+' · Outside selected dates':weekLabel(rangeFor(week),reading,metric,comparison)
            return <button type="button" className="calendar-week" key={week.index} data-week={week.from} data-frp-adjustment={adjustment}
              disabled={disabled} aria-label={title} title={title}
              aria-pressed={value===week.index} aria-haspopup="dialog" aria-expanded={shownWeek?.index===week.index}
              style={{gridColumn:column+2,backgroundColor:view==='grid'?paint(reading.value,getHeat(reading.value,true),metric,historical):undefined}}
              onClick={event=>chooseWeek(week.index,event.currentTarget)}/>
          })}
        </div>)}
      </div>
    </div>
  </section>
}
