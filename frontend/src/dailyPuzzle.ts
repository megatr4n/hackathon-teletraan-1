import { firstDate, scenarios } from './data'
import { dailyStats, dateIndex, viirsStart, type DailyObservation } from './estimates'
import { archiveDates } from './observations'

export type Rule =
  | { kind:'streak'; threshold:number; length:number }
  | { kind:'dayOverDayRise'; minimumFrp:number; minimumRise:number }
  | { kind:'maxNightShare'; minimumNight:number }
type Puzzle = {
  id:string; revision:number; datasetVersion:string; focusId:string; year:number;
  difficulty:'Easy'|'Medium'|'Hard'; region:string; prompt:string; hints:readonly string[];
  rule:Rule; publishedOn:string;
}
export const puzzles:readonly Puzzle[]=[
  {id:'chernobyl-2020-streak',revision:1,datasetVersion:'demo-42e2041',focusId:'chernobyl',year:2020,difficulty:'Easy',region:'Chornobyl',
    prompt:'Find the first day of the first streak with at least 210 detections per day for three consecutive days.',
    hints:['Look in spring.','Use Hotspot Count with Raw Satellite and All Passes.','If the previous day also has at least 210 detections, check an earlier date.'],
    rule:{kind:'streak',threshold:210,length:3},publishedOn:'2026-11-12'},
  {id:'california-2018-frp-rise',revision:1,datasetVersion:'demo-42e2041',focusId:'california',year:2018,difficulty:'Medium',region:'California',
    prompt:'Find the earliest day with FRP of at least 4,500 MW and an increase of at least 1,900 MW from the previous day.',
    hints:['Start in the second half of the year.','Use FRP Energy with Raw Satellite and All Passes.','A bright day after another bright day may have high FRP but only a small increase.'],
    rule:{kind:'dayOverDayRise',minimumFrp:4500,minimumRise:1900},publishedOn:'2026-11-13'},
  {id:'australia-2020-night-share',revision:1,datasetVersion:'demo-42e2041',focusId:'australia',year:2020,difficulty:'Hard',region:'Southeastern Australia',
    prompt:'Among days with at least 125 nighttime detections, find the highest nighttime share of all detections. If tied, choose the earlier date.',
    hints:['Compare dates near the beginning of the year.','Use Raw Satellite and compare Night with All Passes on the same day.','Divide nighttime detections by all detections. Only compare dates with at least 125 nighttime detections.'],
    rule:{kind:'maxNightShare',minimumNight:125},publishedOn:'2026-11-14'},
]
export type { Puzzle }
export type PuzzleDay = { date:string; count:number|null; night:number|null; frp:number|null }
export type PuzzleAnswer = { date:string; evidence:PuzzleDay[]; comparison?:PuzzleDay }
export type PuzzleProgress = { date:string; attempts:number; usedHint:boolean; status:'playing'|'solved'|'revealed' }
export const puzzleBounds=(puzzle:Puzzle)=>({from:puzzle.year+'-01-01',to:puzzle.year+'-12-31'})
export const puzzleFocus=(puzzle:Puzzle)=>scenarios.find(focus=>focus.id===puzzle.focusId)
export const utcDate=()=>new Date().toISOString().slice(0,10)
export const publishedPuzzles=(day:string)=>puzzles.filter(puzzle=>puzzle.publishedOn<=day).slice().reverse()
export const progressKey=(puzzle:Puzzle)=>`teletraan-1-puzzle:${puzzle.id}:${puzzle.revision}:${puzzle.datasetVersion}`

export function puzzleDays(puzzle:Puzzle,history:readonly DailyObservation[]):PuzzleDay[] {
  const {from,to}=puzzleBounds(puzzle)
  const start=dateIndex(from,firstDate), end=dateIndex(to,firstDate)
  return archiveDates.slice(start,end+1).map((date,offset)=>{
    const day=history[start+offset]
    if(!day)return {date,count:null,night:null,frp:null}
    const all=dailyStats(day,'all',date>=viirsStart)
    const night=dailyStats(day,'night',date>=viirsStart)
    return {date,count:all.rawCount,night:night.rawCount,frp:all.raw}
  })
}

function streakWindow(rule:Extract<Rule,{kind:'streak'}>,days:PuzzleDay[],index:number) {
  const window=days.slice(index,index+rule.length)
  return window.length===rule.length&&window.every(day=>day.count!==null&&day.count>=rule.threshold)?window:null
}
function riseMatches(rule:Extract<Rule,{kind:'dayOverDayRise'}>,previous:PuzzleDay|undefined,day:PuzzleDay) {
  return previous?.frp!=null&&day.frp!==null&&day.frp>=rule.minimumFrp&&day.frp-previous.frp>=rule.minimumRise
}
type NightDay=PuzzleDay & {count:number;night:number}
function eligibleNight(rule:Extract<Rule,{kind:'maxNightShare'}>,day:PuzzleDay):day is NightDay {
  return day.count!==null&&day.count>0&&day.night!==null&&day.night>=rule.minimumNight
}

export function solvePuzzle(rule:Rule,days:PuzzleDay[]):PuzzleAnswer|null {
  if(rule.kind==='streak'){
    for(const [index,day] of days.entries()){
      const previous=days[index-1]
      if(previous&&(previous.count===null||previous.count>=rule.threshold))continue
      const window=streakWindow(rule,days,index)
      if(window)return {date:day.date,evidence:window,comparison:previous}
    }
  }else if(rule.kind==='dayOverDayRise'){
    for(let index=1;index<days.length;index++){
      if(riseMatches(rule,days[index-1],days[index]))return {date:days[index].date,evidence:days.slice(index-1,index+1)}
    }
  }else{
    let best:NightDay|undefined, runnerUp:NightDay|undefined
    const exceeds=(a:NightDay,b:NightDay|undefined)=>!b||a.night*b.count>b.night*a.count
    for(const day of days){
      if(!eligibleNight(rule,day))continue
      if(exceeds(day,best)){runnerUp=best;best=day}
      else if(exceeds(day,runnerUp))runnerUp=day
    }
    if(best)return {date:best.date,evidence:[best],comparison:runnerUp}
  }
  return null
}

export const forCount=(value:number|null|undefined)=>value==null?'Unavailable':value.toLocaleString('en-US')
export function forDecimal(value:number|null|undefined,unit:string,threshold?:number) {
  if(value==null)return 'Unavailable'
  const precision=threshold!==undefined&&value!==threshold&&Number(value.toFixed(2))===threshold?5:2
  return value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:precision})+unit
}
export const nightShare=(day:PuzzleDay)=>day.count&&day.night!==null?100*day.night/day.count:null

export function explainAttempt(rule:Rule,days:PuzzleDay[],index:number,answer:PuzzleAnswer):string {
  const day=days[index]
  const previous=days[index-1]
  if(rule.kind==='streak'){
    const window=days.slice(index,index+rule.length)
    if(window.length<rule.length)return 'There are too few days left in this year for a three-day streak.'
    if(window.some(entry=>entry.count===null))return 'At least one required day has no observation.'
    if(previous&&previous.count===null)return 'The previous day has no observation, so the start of the streak cannot be confirmed.'
    if(previous?.count!=null&&previous.count>=rule.threshold)return `The previous day already has ${forCount(previous.count)} detections. Check the start of the streak.`
    if(streakWindow(rule,days,index))return 'This streak qualifies, but an earlier streak also meets the rule.'
    return `The counts are ${window.map(entry=>forCount(entry.count)).join(', ')}. Every day must reach ${rule.threshold}.`
  }
  if(rule.kind==='dayOverDayRise'){
    if(!previous)return 'The previous day must be inside this puzzle year.'
    if(day.frp===null||previous.frp===null)return 'Both days need an FRP observation.'
    const increase=day.frp-previous.frp
    if(riseMatches(rule,previous,day))return 'Both thresholds are met, but an earlier date also qualifies.'
    return `FRP is ${forDecimal(day.frp,' MW',rule.minimumFrp)} and the change is ${forDecimal(increase,' MW',rule.minimumRise)}. Both thresholds must be met.`
  }
  if(day.count===null||day.night===null||day.count<=0)return 'This date has no usable full-day and nighttime comparison.'
  if(day.night<rule.minimumNight)return `${forCount(day.night)} nighttime detections is below the minimum of ${rule.minimumNight}.`
  const winning=answer.evidence[0]
  const candidate=nightShare(day)!
  const best=nightShare(winning)!
  if(day.night * winning.count! === winning.night! * day.count)return 'An earlier eligible day has the same nighttime share.'
  const digits=candidate.toFixed(2)===best.toFixed(2)?5:2
  return `${forCount(day.night)} of ${forCount(day.count)} detections were at night (${candidate.toFixed(digits)}%). Another eligible day has a higher share.`
}

const cache=new Map<string,PuzzleProgress>()
export function readProgress(puzzle:Puzzle):PuzzleProgress {
  const key=progressKey(puzzle)
  const {from,to}=puzzleBounds(puzzle)
  const initial:PuzzleProgress={date:from,attempts:0,usedHint:false,status:'playing'}
  if(cache.has(key))return cache.get(key)!
  try{
    const raw=localStorage.getItem(key)
    if(!raw)return initial
    const value=JSON.parse(raw)
    if(typeof value?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.date)&&value.date>=from&&value.date<=to&&
      archiveDates[dateIndex(value.date,firstDate)]===value.date&&Number.isSafeInteger(value.attempts)&&value.attempts>=0&&
      typeof value.usedHint==='boolean'&&['playing','solved','revealed'].includes(value.status)){
      return {date:value.date,attempts:value.attempts,usedHint:value.usedHint,status:value.status}
    }
  }catch{ /* Fall back to a new round when storage or its contents are unavailable. */ }
  return initial
}
export function saveProgress(puzzle:Puzzle,progress:PuzzleProgress) {
  const key=progressKey(puzzle)
  cache.set(key,progress)
  try{localStorage.setItem(key,JSON.stringify(progress))}catch{ /* Keep the round in this tab. */ }
}

