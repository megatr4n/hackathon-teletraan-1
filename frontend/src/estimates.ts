import { calibration, dailyFrp, periodFrpMinimumDays } from './calibration'
import { DAY, type Cell, type Focus, type Pass } from './data'

const sigma=5.670374419e-8
const emissivity=.95
const fireTemperature=800
const ambientTemperature=300
const dryMatterPerMJ=.368
const co2PerDryMatter=1.626
export const viirsStart='2012-01-01'

type Observation = { frp:number; count:number; viirsFrp:number; viirsCount:number; cells:number }
export type DailyObservation = Record<'day'|'night',Observation>
const blank=():Observation=>({frp:0,count:0,viirsFrp:0,viirsCount:0,cells:0})
export const emptyObservation=():DailyObservation=>({day:blank(),night:blank()})

export function cellObservations(cell:Cell,pass:Pass) {
  const rawCount=Math.max(1,Math.round(cell.raw/20))
  const variation=(cell.weight%1)
  return {
    rawCount,
    correctedCount:rawCount*calibration.hotspots[pass],
    correctedFrp:cell.raw*calibration.dailyFrp[cell.pass],
    viirsFrp:cell.raw*.74*(.91+variation*.18),
    viirsCount:Math.round(rawCount*(cell.pass==='day'?4.8:18.2)*(.9+variation*.2)),
  }
}

export function addObservation(day:DailyObservation,cell:Cell) {
  const stats=day[cell.pass]
  const observation=cellObservations(cell,cell.pass)
  stats.frp+=cell.raw
  stats.count+=observation.rawCount
  stats.viirsFrp+=observation.viirsFrp
  stats.viirsCount+=observation.viirsCount
  stats.cells++
}

export function dailyStats(data:DailyObservation,pass:Pass,hasViirs:boolean) {
  const day=pass==='night'?blank():data.day
  const night=pass==='day'?blank():data.night
  const raw=day.frp+night.frp
  const rawCount=day.count+night.count
  return {
    raw,
    corrected:dailyFrp(day.frp,night.frp),
    rawCount,
    correctedCount:rawCount*calibration.hotspots[pass],
    viirs:hasViirs?day.viirsFrp+night.viirsFrp:0,
    viirsCount:hasViirs?day.viirsCount+night.viirsCount:0,
    cells:day.cells+night.cells,
  }
}
export type DailyStats=ReturnType<typeof dailyStats>
export function periodStats(series:DailyStats[],start:number,end:number,pass:Pass,viirsDayIndex:number) {
  const days=end-start+1
  const viirsDays=Math.max(0,end-Math.max(start,viirsDayIndex)+1)
  const totals:DailyStats={raw:0,corrected:0,rawCount:0,correctedCount:0,viirs:0,viirsCount:0,cells:0}
  let peak=0, peakDay=start, activeDays=0
  const usePeriodCoefficient=days>=periodFrpMinimumDays
  for(let i=start;i<=end;i++) {
    const daily=series[i]
    const corrected=usePeriodCoefficient?daily.raw*calibration.periodFrp[pass]:daily.corrected
    totals.raw+=daily.raw
    totals.corrected+=corrected
    totals.rawCount+=daily.rawCount
    totals.correctedCount+=daily.correctedCount
    totals.viirs+=daily.viirs
    totals.viirsCount+=daily.viirsCount
    totals.cells+=daily.cells
    if(daily.cells)activeDays++
    if(corrected>peak){peak=corrected;peakDay=i}
  }
  return {totals,days,viirsDays,activeDays,peak,peakDay,usePeriodCoefficient}
}
export function dailyEstimates(stats:DailyStats,harmonized:boolean,focus:Focus) {
  const frp=harmonized?stats.corrected:stats.raw
  const fre=focus.harmonized?focus.fre*frp/focus.harmonized:0
  const area=frp/(emissivity*sigma*(fireTemperature**4-ambientTemperature**4))
  const co2=fre*1000*dryMatterPerMJ*co2PerDryMatter
  return {frp,fre,area,co2}
}
export const dateIndex=(date:string,origin:string)=>Math.round((Date.parse(date)-Date.parse(origin))/DAY)
