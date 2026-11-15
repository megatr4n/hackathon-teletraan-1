import { useEffect, useMemo, useState } from 'react'
import { observations } from './observations'
import {
  explainAttempt, publishedPuzzles, puzzleDays, puzzleFocus, readProgress,
  saveProgress, solvePuzzle, utcDate, type Puzzle,
} from './dailyPuzzle'

function sharedEdition() {
  const query=new URLSearchParams(window.location.search)
  if(!query.has('puzzle'))return undefined
  return publishedPuzzles(utcDate()).find(entry=>entry.id===query.get('puzzle')&&String(entry.revision)===query.get('rev'))??null
}

export function useDailyPuzzle(focusId:string, selectedDate:string|null, onMessage:(message:string)=>void) {
  const [today,setToday]=useState(utcDate)
  const [open,setOpen]=useState(()=>new URLSearchParams(window.location.search).has('puzzle'))
  const [edition,setEdition]=useState<Puzzle|null|undefined>(sharedEdition)
  const [hint,setHint]=useState<number|null>(null)
  const [feedback,setFeedback]=useState<{text:string;kind:'notice'|'incorrect'|'correct'}|null>(null)
  const [version,setVersion]=useState(0)
  const editions=useMemo(()=>publishedPuzzles(today),[today])
  const puzzle=edition===undefined?editions[0]:edition??undefined
  const days=useMemo(()=>{
    const focus=puzzle&&open?puzzleFocus(puzzle):undefined
    return focus&&puzzle?puzzleDays(puzzle,observations(focus).history()):[]
  },[puzzle,open])
  const answer=useMemo(()=>puzzle&&days.length?solvePuzzle(puzzle.rule,days):null,[puzzle,days])
  const progress=useMemo(()=>puzzle?readProgress(puzzle):null,[puzzle,version])
  const solved=progress?.status==='solved'

  useEffect(()=>{
    let timer=0
    const refresh=()=>{
      const now=Date.now()
      const day=utcDate()
      setToday(day)
      window.clearTimeout(timer)
      timer=window.setTimeout(refresh,Date.parse(day)+86_400_000-now+20)
    }
    refresh()
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    return ()=>{
      window.clearTimeout(timer)
      window.removeEventListener('focus',refresh)
      document.removeEventListener('visibilitychange',refresh)
    }
  },[])

  function toggle(){
    setToday(utcDate())
    if(open){close();return}
    setOpen(true)
  }
  function choose(next:Puzzle|undefined){
    setToday(utcDate())
    setEdition(next)
    setHint(null)
    setFeedback(null)
  }
  function close(){
    setOpen(false)
    setHint(null)
    setFeedback(null)
  }
  function changeHint(index:number){
    setHint(current=>current===index?null:index)
    if(puzzle&&progress&&!progress.usedHint){
      saveProgress(puzzle,{...progress,usedHint:true})
      setVersion(current=>current+1)
    }
  }
  function check(){
    if(!puzzle||!progress||solved)return
    if(!selectedDate){
      setFeedback({text:'Open a week in the calendar, select a day, then check your answer.',kind:'notice'})
      return
    }
    if(focusId!==puzzle.focusId){
      setFeedback({text:`Select Go to region to open ${puzzle.region}, then check the selected day.`,kind:'notice'})
      return
    }
    const index=days.findIndex(day=>day.date===selectedDate)
    if(index<0){
      setFeedback({text:`Select a date in ${puzzle.year} for this puzzle.`,kind:'notice'})
      return
    }
    if(!answer){
      setFeedback({text:'This puzzle is unavailable.',kind:'notice'})
      return
    }
    const correct=selectedDate===answer.date
    saveProgress(puzzle,{...progress,date:selectedDate,attempts:progress.attempts+1,status:correct?'solved':'playing'})
    setVersion(current=>current+1)
    setFeedback(correct?{text:`Correct. ${selectedDate} solves this puzzle.`,kind:'correct'}:
      {text:explainAttempt(puzzle.rule,days,index,answer),kind:'incorrect'})
  }
  async function share(){
    if(!puzzle||!solved)return
    const url=new URL(window.location.href)
    url.search=''
    url.hash=''
    url.searchParams.set('puzzle',puzzle.id)
    url.searchParams.set('rev',String(puzzle.revision))
    try{
      await navigator.clipboard.writeText(url.href)
      onMessage('Puzzle link copied')
    }catch{
      onMessage('Could not copy the puzzle link')
    }
  }
  return {open,toggle,close,editions,puzzle,progress,solved,choose,hint,changeHint,feedback,check,share}
}

