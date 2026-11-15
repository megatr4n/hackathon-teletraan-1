import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import { calibration, periodFrpMinimumDays } from './calibration'
import { doy, number } from './data'
import type { DailyStats, dailyEstimates, periodStats } from './estimates'
import { archiveDates } from './observations'
import type { Snapshot } from './pins'
import fontUrl from './report/NotoSans-Regular.ttf?url'

type Report = {
  settings:Snapshot
  day:DailyStats
  period:ReturnType<typeof periodStats>
  estimates:ReturnType<typeof dailyEstimates>
  viirs:boolean
  adjustment:number
  delta:number
  severity:'critical'|'elevated'|'normal'
  activeCells:number
  wape:string
  bias:string
}
type Triple = [number,number,number|null]
type Row = [string,string,string,string,string]

const ink='#0F172A', muted='#475569', border='#CBD5E1', panel='#F8FAFC'
const sensors=['Raw MODIS','Harmonized MODIS','VIIRS']
const colors=['#94A3B8','#D97706','#1D4ED8']
const areaModes={countries:'Countries',ecoregions:'Eco-regions',custom:'Custom Area'}
const passLabels={all:'All Passes',day:'Day',night:'Night'}
const metricLabels={frp:'FRP Energy',count:'Hotspots Count',z:'Z-Score'}
const viewLabels={grid:'Grid Matrix',ridge:'Ridge Waves'}
const margin=15, right=195, width=180
const display=(value:number|null)=>value===null?'—':number(value)
const signed=(value:number,precision=1)=>(value>0?'+':'')+value.toFixed(precision)+'%'
let fontData:Promise<string>|undefined

async function loadFont() {
  fontData??=fetch(fontUrl).then(async response=>{
    if(!response.ok)throw new Error('Report font unavailable')
    const bytes=new Uint8Array(await response.arrayBuffer())
    let binary=''
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
    return btoa(binary)
  }).catch(error=>{fontData=undefined;throw error})
  return fontData
}

function heading(pdf:jsPDF,label:string,x:number,y:number,size=14) {
  pdf.setFont('times','bold').setFontSize(size).setTextColor(ink).text(label,x,y)
}
function text(pdf:jsPDF,label:string,x:number,y:number,size=9,color=ink,align:'left'|'right'='left') {
  pdf.setFont('Noto Sans','normal').setFontSize(size).setTextColor(color).text(label,x,y,{align})
}
function rule(pdf:jsPDF,x:number,y:number,w:number) {
  pdf.setDrawColor(border).setLineWidth(.265).line(x,y,x+w,y)
}
function footer(pdf:jsPDF,page:number) {
  rule(pdf,margin,275,width)
  text(pdf,'TELETRAAN-1  /  Scientific intercalibration report  /  Synthetic fire observations',margin,280,7.5,muted)
  text(pdf,`PAGE ${page} / 2`,right,280,7.5,muted,'right')
}
function queryRows(settings:Snapshot,days:number):[string,string][] {
  const {aoi,areaMode,focus,from,to,pass,query,radius,metric,calendarView}=settings
  const frp=pass==='all'?`${calibration.dailyFrp.day.toFixed(3)} day / ${calibration.dailyFrp.night.toFixed(3)} night`:calibration.dailyFrp[pass].toFixed(3)
  const rows:[string,string][]=[
    ['Area of Interest Mode',areaModes[areaMode]],
    ['Selected Area',`${focus.name} (${focus.area})`],
    ['Archive Period',`${from} to ${to} (${number(days)} ${days===1?'day':'days'})`],
    ['Orbital Pass Filter',passLabels[pass]],
    ['Daily K_FRP / K_COUNT',`${frp}  |  ${calibration.hotspots[pass].toFixed(3)}`],
    ['Period FRP coefficient',`${calibration.periodFrp[pass].toFixed(3)} for periods of at least ${periodFrpMinimumDays} days`],
    ['Calendar metric / view',`${metricLabels[metric]}  |  ${viewLabels[calendarView]}`],
  ]
  if(query.trim())rows.push(['Search query',query.trim()])
  if(areaMode==='custom'){
    rows.push(['Radius input',`${radius} km`])
    if(aoi?.type==='circle')rows.push(['Radial circle',`${aoi.center[1].toFixed(5)}°, ${aoi.center[0].toFixed(5)}° (lat, lon); ${aoi.radius} km`])
    if(aoi?.type==='lasso'){
      const lons=aoi.ring.map(([lon])=>lon)
      const lats=aoi.ring.map(([,lat])=>lat)
      const bounds=(values:number[])=>`${Math.min(...values).toFixed(4)}° to ${Math.max(...values).toFixed(4)}°`
      rows.push(['Freehand lasso',`${aoi.ring.length} points; lat ${bounds(lats)}, lon ${bounds(lons)}`])
    }
  }
  return rows
}

function fitted(pdf:jsPDF,label:string,maxWidth:number):string {
  if(pdf.getTextWidth(label)<=maxWidth)return label
  let end=label.length
  while(end>0&&pdf.getTextWidth(label.slice(0,end)+'…')>maxWidth)end--
  return label.slice(0,end)+'…'
}
function passport(pdf:jsPDF,rows:[string,string][],start:number) {
  let y=start
  for(const [label,value] of rows){
    pdf.setFont('Noto Sans','normal').setFontSize(8)
    const lines:string[]=pdf.splitTextToSize(value,126)
    const h=2.8+Math.min(lines.length,2)*3.65
    pdf.setFillColor(panel).rect(margin,y,width,h,'F')
    text(pdf,label,margin+2.5,y+4.3,8,muted)
    lines.slice(0,2).forEach((line,i)=>text(pdf,i===1&&lines.length>2?fitted(pdf,line+'…',126):line,margin+50,y+4.3+i*3.65,8))
    y+=h
    rule(pdf,margin,y,width)
  }
  return y
}

function sensorTable(pdf:jsPDF,groups:{title:string;rows:Row[]}[],start:number) {
  const edges=[15,65,91,120,140,195]
  const header=['Time slice and metric',...sensors,'Note / correction']
  pdf.setFillColor('#E2E8F0').rect(margin,start,width,9,'F')
  const headerColors=[ink,muted,colors[1],colors[2],ink]
  header.forEach((label,i)=>text(pdf,label,edges[i]+2,start+5.7,8,headerColors[i]))
  let y=start+9
  for(const group of groups){
    pdf.setFillColor(panel).rect(margin,y,width,7,'F')
    text(pdf,group.title,margin+2,y+4.7,8.3,ink)
    y+=7
    for(const row of group.rows){
      row.forEach((value,i)=>{
        const numeric=i>0&&i<4
        if(i===2)pdf.setFillColor('#FFF7ED').rect(edges[i],y,edges[i+1]-edges[i],7,'F')
        text(pdf,value,numeric?edges[i+1]-3:edges[i]+2,y+4.7,i===4?7.3:8.1,i===4?muted:ink,numeric?'right':'left')
      })
      y+=7
      rule(pdf,margin,y,width)
    }
  }
  return y
}

const svgNamespace='http://www.w3.org/2000/svg'
function chartPanel(title:string,values:Triple,unit:string,annotation?:string) {
  const svg=document.createElementNS(svgNamespace,'svg')
  svg.setAttribute('width','320')
  svg.setAttribute('height','134')
  svg.setAttribute('viewBox','0 0 320 134')
  function draw(tag:'text'|'line'|'rect',attrs:Record<string,string|number>,content?:string) {
    const element=document.createElementNS(svgNamespace,tag)
    Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,String(value)))
    if(content!==undefined)element.textContent=content
    svg.appendChild(element)
  }
  function label(str:string,x:number,y:number,size=10,anchor='start',fill=muted) {
    draw('text',{x,y,fill,'font-size':size,'font-family':'helvetica','font-style':'normal','font-weight':'normal','text-anchor':anchor},str)
  }
  const peak=Math.max(1,...values.map(value=>value??0))
  const scale=10**Math.floor(Math.log10(peak))
  const top=Math.ceil(peak/scale*2.5)*scale/2
  const baseline=111
  const height=75
  label(title,1,12,12,'start',ink)
  label(unit,309,12,10,'end')
  for(let i=0;i<=4;i++){
    const y=baseline-height*i/4
    draw('line',{x1:47,x2:316,y1:y,y2:y,stroke:i===0?muted:border,'stroke-width':.7})
    label(number(top*i/4),43,y+3,9,'end')
  }
  draw('line',{x1:47,x2:47,y1:baseline-height,y2:baseline,stroke:muted,'stroke-width':.7})
  values.forEach((value,i)=>{
    const x=90+i*89
    const h=height*(value??0)/top
    if(value!==null)draw('rect',{x:x-16,y:baseline-h,width:32,height:h,fill:colors[i]})
    label(value===null?'N/A':number(value),x,baseline-h-4,11,'middle',ink)
    label(sensors[i],x,127,9,'middle')
  })
  if(annotation)label(annotation,137,25,10,'middle','#92400E')
  return svg
}

function summaryTable(pdf:jsPDF,title:string,rows:[string,string][],x:number,y:number) {
  const w=86
  heading(pdf,title,x,y,10)
  y+=3
  for(const [label,value] of rows){
    pdf.setFillColor(panel).rect(x,y,w,13,'F')
    text(pdf,label,x+2,y+4.8,7.9,muted)
    text(pdf,value,x+w-2,y+10,8.7,ink,'right')
    y+=13
    rule(pdf,x,y,w)
  }
}

export async function exportStatisticalReport(report:Report) {
  const {settings,day,period,estimates,viirs,adjustment,delta,severity,activeCells,wape,bias}=report
  const {focus,date}=settings
  const pdf=new jsPDF({format:'a4',orientation:'portrait',unit:'mm',compress:true,putOnlyUsedFonts:true})
  const font=await loadFont()
  pdf.addFileToVFS('NotoSans-Regular.ttf',font)
  pdf.addFont('NotoSans-Regular.ttf','Noto Sans','normal')
  pdf.setProperties({title:'Wildfire Scientific Intercalibration & Activity Report',subject:focus.name,creator:'TELETRAAN-1'})

  const counts:Triple=[day.rawCount,day.correctedCount,viirs?day.viirsCount:null]
  const power:Triple=[day.raw,day.corrected,viirs?day.viirs:null]
  const {totals,days,viirsDays}=period
  const totalCounts:Triple=[totals.rawCount,totals.correctedCount,viirsDays?totals.viirsCount:null]
  const totalPower:Triple=[totals.raw,totals.corrected,viirsDays?totals.viirs:null]
  const averageCounts:Triple=[totals.rawCount/days,totals.correctedCount/days,viirsDays?totals.viirsCount/viirsDays:null]
  const averagePower:Triple=[totals.raw/days,totals.corrected/days,viirsDays?totals.viirs/viirsDays:null]
  const row=(label:string,[raw,harmonized,reference]:Triple,note=''):Row=>[label,display(raw),display(harmonized),display(reference),note]

  heading(pdf,'Wildfire Scientific Intercalibration & Activity Report',margin,21,17)
  pdf.setFont('Noto Sans','normal').setFontSize(20)
  text(pdf,fitted(pdf,focus.name,width),margin,35,20)
  text(pdf,focus.area,margin,42,10,muted)
  text(pdf,`Selected day  ${date}  ·  DOY ${String(doy(date)).padStart(3,'0')}`,margin,51,9)
  const status=severity==='critical'?'CRITICAL ANOMALY':severity==='elevated'?'ELEVATED':'NOMINAL'
  pdf.setFillColor(severity==='critical'?'#FEF2F2':panel).roundedRect(102,46,36,7,1,1,'F')
  text(pdf,status,104.5,50.7,7.4,severity==='critical'?'#B91C1C':muted)
  text(pdf,`WAPE ${wape}  |  BIAS ${bias}`,right,51,8,muted,'right')
  rule(pdf,margin,56,width)

  heading(pdf,'Query parameters',margin,65)
  const next=passport(pdf,queryRows(settings,days),69)+11
  heading(pdf,'Table 1. Sensor intercalibration',margin,next)
  const coverage=`VIIRS: ${number(viirsDays)} days`
  const tableEnd=sensorTable(pdf,[
    {title:`Selected day  ·  ${date}`,rows:[row('Hotspots',counts),row('FRP (MW)',power,`Daily adjustment ${signed(adjustment)}`)]},
    {title:`Period totals  ·  ${number(days)} days`,rows:[row('Hotspots sum',totalCounts),row('FRP sum (MW·day)',totalPower)]},
    {title:'Daily averages',rows:[row('Hotspots / day',averageCounts,coverage),row('Average FRP (MW)',averagePower,coverage)]},
  ],next+4)
  const footnote=viirsDays
    ?`VIIRS daily averages cover ${number(viirsDays)} days from 2012 onward. MODIS covers all ${number(days)} selected days.`
    :`The selected period contains no VIIRS coverage. MODIS covers all ${number(days)} selected days.`
  text(pdf,footnote,margin,tableEnd+5.5,7.7,muted)
  footer(pdf,1)

  pdf.addPage()
  heading(pdf,'Visual analytics',margin,21,17)
  text(pdf,'Selected day and daily averages are plotted on independent scales.',margin,28,9,muted)
  heading(pdf,'Figure 1. Hotspots comparison',margin,39,12)
  await pdf.svg(chartPanel(date,counts,'Hotspots'),{x:margin,y:44,width:86,height:36})
  await pdf.svg(chartPanel('Daily average',averageCounts,'Hotspots / day'),{x:109,y:44,width:86,height:36})
  rule(pdf,margin,85,width)
  heading(pdf,'Figure 2. Fire radiative power comparison',margin,94,12)
  await pdf.svg(chartPanel(date,power,'MW',`Daily adjustment ${signed(adjustment)}`),{x:margin,y:99,width:86,height:36})
  await pdf.svg(chartPanel('Daily average',averagePower,'MW'),{x:109,y:99,width:86,height:36})
  rule(pdf,margin,140,width)

  heading(pdf,'Table 2. Activity, historical context and environmental impact',margin,154,13)
  summaryTable(pdf,'2A. Activity and historical context',[
    ['Days with detections',`${number(period.activeDays)} / ${number(days)}`],
    ['Peak harmonized FRP day',period.peak?`${archiveDates[period.peakDay]}  ·  ${number(period.peak)} MW`:'—'],
    ['Deviation from historical median',`${signed(delta,0)}  ·  Baseline ${number(focus.median)} MW`],
    ['Severity rank',activeCells?`#${focus.rank} / 26 years  ·  ${focus.percentile.toFixed(1)}th percentile`:'—'],
  ],margin,165)
  summaryTable(pdf,'2B. Spatial and environmental estimates',[
    ['Active fire cells',`${number(activeCells)} cells`],
    ['Radiative energy',`${number(estimates.fre)} TJ`],
    ['Estimated fire area',`${number(estimates.area)} km²`],
    ['Estimated CO₂ emissions',`${number(estimates.co2)} t`],
  ],109,165)
  footer(pdf,2)

  const filename=`teletraan-1-${focus.id.replace(/[^a-z0-9-]/gi,'-')}-${date}-report.pdf`
  pdf.save(filename)
}


export type { HistoricalReport } from './report/analysis'
import type { HistoricalReport } from './report/analysis'
import { buildHistoricalPdf } from './report/historicalPdf'

export async function exportHistoricalReport(settings:Snapshot,report:HistoricalReport,from:string,to:string) {
  if(report.report_start!==from||report.report_end!==to)throw new Error('Report period changed; please retry.')
  const pdf=buildHistoricalPdf(report,settings.focus.name,await loadFont())
  pdf.save('teletraan-1-'+from+'-'+to+'-historical-report.pdf')
}
