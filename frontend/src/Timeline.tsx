import { CalendarDays, ChartNoAxesCombined, ChevronDown, Grid3X3, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { DAY, doy, firstDate, iso, lastDate, prettyDate, years, clampDate } from './data'
import { archiveDates } from './observations'
import { dateIndex, type DailyStats } from './estimates'
import { Button, Segmented } from './ui'
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CalendarView, Metric } from './pins'

const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const palette=['#1b2630','#29353d','#443338','#663a35','#954832','#c86638','#ef8f4b','#ffc575']
const observedPalette=['#1b2630','#705047','#875443','#a05e47','#b96c44','#d2804c','#ef9a57','#ffc575']
const belowBaselinePalette=['#1b2630','#355268','#3d6581','#467b9c','#4e94b6','#60a9cc','#7abfe1','#a7d9f3']
const metricLabels = {frp:'FRP Energy',count:'Hotspot Count',z:'Z-Score'}
type HistoricalDay = { value:number|null; source:string; details?:string }
const yearDays=years.map(year=>{
  const start=dateIndex(year+'-01-01',firstDate)
  const split=dateIndex(year+'-07-01',firstDate)
  const end=dateIndex((year+1)+'-01-01',firstDate)
  return {year,halves:[[start,split],[split,end]]}
})

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

const YearRows=memo(function YearRows({year,halves,current,from,to,values,heats,metric,view,historicalDays}:{
  year:number;halves:number[][];current:string;from:string;to:string;values:(number|null)[];heats:number[];metric:Metric;view:CalendarView;historicalDays?:HistoricalDay[]
}) {
  return <div className={'daily-year '+(current?'selected-year':'')} data-year={year}>
    <span className="year mono">{year}{[2020,2018,2015].includes(year)&&<i/>}</span>
    {halves.map(([start,end],half)=>{
      const dates=archiveDates.slice(start,end)
      const line=dates.map((_,i)=>values[start+i]===null?i+',16':i+','+(16-15*heats[start+i])).join(' ')
      return <div className={'daily-half '+(view==='ridge'?'daily-ridge':'')} key={half}>
        <span className="half-label mono">{half===0?'JAN–JUN':'JUL–DEC'}</span>
        <div className="daily-cells" style={{'--days':dates.length} as CSSProperties}>
          {view==='ridge'&&<svg viewBox={'0 0 '+(dates.length-1)+' 16'} preserveAspectRatio="none" aria-hidden="true"><polygon points={'0,16 '+line+' '+(dates.length-1)+',16'} fill="#bb75475c" stroke="#f3935b" strokeWidth=".6"/></svg>}
          {dates.map((date,i)=>{
            const active=date===current
            const amount=values[start+i]
            const label=historicalDays&&metric==='frp'?'Fire radiative power':metricLabels[metric]
            const source=historicalDays?.[start+i].source
            const details=historicalDays?.[start+i].details
            const title=date+' · '+label+' · '+(amount===null?(details??'No observed value'):amount.toLocaleString('en-US',{maximumFractionDigits:2})+
              (metric==='frp'?' MW':metric==='count'?' hotspots':'')+(source?' · '+source:'')+(details?' · '+details:''))
            const colorIndex=Math.min(7,Math.floor(heats[start+i]*8))
            const colors=historicalDays?(metric==='z'&&(amount??0)<0?belowBaselinePalette:observedPalette):palette
            return <button type="button" key={date} data-date={date} disabled={date<from||date>to} tabIndex={active?0:-1}
              aria-label={title} aria-pressed={active} title={title} className={active?'selected-cell':undefined}
              style={view==='grid'?{backgroundColor:colors[colorIndex]}:undefined}/>
          })}
        </div>
      </div>
    })}
  </div>
})

export function Timeline({date,from,to,playing,onPlay,onSelect,series,historicalDays,historyReady,harmonized,onRange,metric,view,onMetric,onView}:{
  date:string;from:string;to:string;playing:boolean;onPlay:()=>void;onSelect:(date:string,focus?:boolean)=>void;
  series:DailyStats[];harmonized:boolean;onRange:(from:string,to:string)=>void;metric:Metric;view:CalendarView;
  onMetric:(metric:Metric)=>void;onView:(view:CalendarView)=>void
  historicalDays?:HistoricalDay[]
  historyReady?:boolean
}) {
  const historical=historicalDays!==undefined
  const min=Date.parse(from), max=Date.parse(to), value=Date.parse(date)
  const change=(amount:number)=>onSelect(iso(Math.min(max,Math.max(min,value+amount*DAY))),true)
  const {values,heats}=useMemo(()=>{
    if(historicalDays){
      const values=historicalDays.map(day=>day.value)
      const observed=values.flatMap(value=>value===null?[]:[Math.abs(value)]).sort((a,b)=>a-b)
      const reference=Math.max(1,observed[Math.floor((observed.length-1)*.95)]??0)
      const ceiling=Math.log1p(reference)
      return {values,heats:values.map(value=>value===null?0:Math.min(1,.125+.875*Math.log1p(Math.abs(value))/ceiling))}
    }
    const powers=series.map(day=>harmonized?day.corrected:day.raw)
    const mean=powers.reduce((a,b)=>a+b,0)/powers.length
    const deviation=Math.sqrt(powers.reduce((sum,power)=>sum+(power-mean)**2,0)/powers.length)||1
    const values=metric==='frp'?powers:metric==='count'?series.map(day=>harmonized?day.correctedCount:day.rawCount):powers.map(power=>(power-mean)/deviation)
    const peak=Math.max(1,...values)
    return {values,heats:values.map(amount=>Math.max(0,amount/peak)**.7)}
  },[series,metric,harmonized,historicalDays])
  const observedDayCount=useMemo(()=>values.slice(dateIndex(from,firstDate),dateIndex(to,firstDate)+1)
    .filter(value=>value!==null).length,[from,to,values])
  const periodDays=dateIndex(to,from)+1
  return <section className="timeline" aria-label="Burning activity calendar">
    <div className="timeline-top compact-timeline">
      <div className="timeline-title"><span className="section-icon"><CalendarDays size={16}/></span><div><h2>Burning activity calendar</h2><span className="mono">2000–2025 ARCHIVE</span></div></div>
      <DateRangeFields from={from} to={to} onRange={onRange}/>
      <div className="timeline-player">
        <div className="timeline-controls">
          <Button aria-label="Previous day" title="Previous day" onClick={()=>change(-1)}><SkipBack size={14}/></Button>
          <Button aria-label={playing?'Pause timeline':'Play timeline'} title={playing?'Pause timeline':'Play timeline'} className="play-button" onClick={onPlay}>{playing?<Pause size={15}/>:<Play size={15}/>}</Button>
          <Button aria-label="Next day" title="Next day" onClick={()=>change(1)}><SkipForward size={14}/></Button>
          <input aria-label="Scrub through dates" type="range" min={min} max={max} step={DAY} value={value}
            style={{'--progress':(max===min?0:100*(value-min)/(max-min))+'%'} as CSSProperties} onChange={event=>onSelect(iso(Number(event.target.value)))}/>
          <span className="timeline-date mono">{prettyDate(date)} <b>DOY {String(doy(date)).padStart(3,'0')}</b></span>
        </div>
        <p className="timeline-note">{historical?
          historyReady?<><strong>{observedDayCount.toLocaleString('en-US')} / {periodDays.toLocaleString('en-US')} days with values.</strong>{' '}
            {metric==='z'?'Raw MODIS FRP, ±7 days in at least eight other years. Blue is below baseline.':
              'Gray means no value. Day tooltips show the source and value.'}</>:
            'Loading archive values…':
          '*harmonized FRP data for specific days may be inaccurate due to potential external factors (e.g., cloud cover).'}</p>
      </div>
      <div className="timeline-view">
        <MetricPicker metric={metric} onMetric={onMetric}/>
        <Segmented label="Calendar view" value={view} onChange={onView} items={[{value:'grid',label:<><Grid3X3 size={13}/> Grid Matrix</>},{value:'ridge',label:<><ChartNoAxesCombined size={14}/> Ridge Waves</>}]}/>
      </div>
    </div>
    <div className="daily-calendar" tabIndex={0} aria-label="Daily archive, 2000 to 2025"
      onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();change(event.key==='ArrowLeft'?-1:1)}}}
      onClick={event=>{const chosen=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');if(chosen?.dataset.date&&!chosen.disabled)onSelect(chosen.dataset.date,true)}}>
      <div className="daily-calendar-inner">
        <div className="daily-months mono"><span>YEAR</span><span>HALF</span><div>{months.slice(0,6).map((month,i)=><span key={month}>{month}<small>{months[i+6]}</small></span>)}</div></div>
        {yearDays.map(({year,halves})=><YearRows key={year} year={year} halves={halves} current={date.startsWith(String(year))?date:''} from={from} to={to} values={values} heats={heats} metric={metric} view={view} historicalDays={historicalDays}/>)}
      </div>
    </div>
  </section>
}
