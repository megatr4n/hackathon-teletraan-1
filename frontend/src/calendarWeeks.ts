import { DAY, firstDate, iso, lastDate, years, type MapCell } from './data'

const weekMs=7*DAY
const first=Date.parse(firstDate)
const last=Date.parse(lastDate)
const mondayAnchor=first-((new Date(first).getUTCDay()+6)%7)*DAY

export type CalendarWeek={index:number;monday:string;from:string;to:string}

export function weekIndex(day:string) {
  return Math.floor((Date.parse(day)-mondayAnchor)/weekMs)
}

export const calendarWeeks:CalendarWeek[]=Array.from({length:weekIndex(lastDate)+1},(_,index)=>{
  const monday=mondayAnchor+index*weekMs
  return {index,monday:iso(monday),from:iso(Math.max(first,monday)),to:iso(Math.min(last,monday+6*DAY))}
})

export const weeksByYear=years.map(year=>({
  year,weeks:calendarWeeks.filter(week=>week.from.startsWith(String(year))),
}))

export function weekRange(week:CalendarWeek,from:string,to:string) {
  return {from:week.from<from?from:week.from,to:week.to>to?to:week.to}
}

export function nextWeekDate(date:string,from:string,to:string) {
  const next=weekIndex(date)+1
  return next>weekIndex(to)?from:weekRange(calendarWeeks[next],from,to).from
}

export function datesInRange(from:string,to:string) {
  const start=Date.parse(from)
  return Array.from({length:Math.max(0,(Date.parse(to)-start)/DAY+1)},(_,index)=>iso(start+index*DAY))
}

export function summarizeWeek(values:readonly (number|null)[],peak:boolean) {
  let value:number|null=null
  let observed=0
  for(const reading of values){
    if(reading===null)continue
    observed++
    if(!peak)value=(value??0)+reading
    else if(value===null||Math.abs(reading)>Math.abs(value))value=reading
  }
  return {value,observed,days:values.length}
}

export function sumMapCells(days:readonly MapCell[][]):MapCell[] {
  const cells=new Map<string,MapCell>()
  for(const day of days)for(const cell of day){
    const prior=cells.get(cell.id)
    if(!prior)cells.set(cell.id,{...cell})
    else{
      prior.weight+=cell.weight
      if(cell.raw!==null)prior.raw=(prior.raw??0)+cell.raw
    }
  }
  return [...cells.values()]
}
