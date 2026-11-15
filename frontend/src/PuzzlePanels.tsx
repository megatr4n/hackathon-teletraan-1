import { useEffect, useId, useRef, type ReactNode, type CSSProperties } from 'react'
import { prettyDate } from './data'
import { MapPin } from 'lucide-react'
import type { Puzzle } from './dailyPuzzle'
import type { useDailyPuzzle } from './useDailyPuzzle'
import { Button } from './ui'

type PuzzleState=ReturnType<typeof useDailyPuzzle>

function PuzzleSparks() {
  return <div className="puzzle-sparks" aria-hidden="true">
    {Array.from({length:36},(_,index)=>{
      const angle=index*2.399963
      const radius=42+(index*31)%116
      return <i key={index} style={{
        '--spark-x':Math.cos(angle)*radius+'px',
        '--spark-y':Math.sin(angle)*radius*.72+'px',
        '--spark-angle':angle+'rad',
        '--spark-delay':(index%6)*28+'ms',
      } as CSSProperties}/>
    })}
  </div>
}

export function PuzzleDropdown({game,onRegion,trigger}:{game:PuzzleState;onRegion:(puzzle:Puzzle)=>void;trigger:(id:string)=>ReactNode}) {
  const root=useRef<HTMLDivElement>(null)
  const id=useId()
  const {open,close}=game
  const closeRef=useRef(close)
  closeRef.current=close

  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{
      if(!root.current?.contains(event.target as Node))closeRef.current()
    }
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||event.defaultPrevented)return
      closeRef.current()
      root.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',escape)
    return ()=>{
      document.removeEventListener('pointerdown',outside)
      document.removeEventListener('keydown',escape)
    }
  },[open])

  const {puzzle,progress,solved,feedback,hint}=game
  return <div className="puzzle-dock" ref={root}>
    {trigger(id)}
    {open&&<section id={id} className="puzzle-dropdown" aria-label="Daily Puzzle details">
      {puzzle?<>
        <div className="puzzle-heading">
          <div className="puzzle-region-heading"><h2>{puzzle.region}</h2>
            <time dateTime={puzzle.publishedOn}>· {prettyDate(puzzle.publishedOn)} UTC</time>
          </div>
          <span>{puzzle.year} · {puzzle.difficulty}</span>
        </div>
        <p className="puzzle-prompt">{puzzle.prompt}</p>
        <Button className="puzzle-region-link" onClick={()=>onRegion(puzzle)}><MapPin size={14}/> Go to region</Button>
        <div className="puzzle-actions">
          <Button className={solved?'puzzle-share':'puzzle-check'} onClick={solved?game.share:game.check}>{solved?'Share':'Check'}</Button>
          {puzzle.hints.map((_,index)=><Button key={index} aria-expanded={hint===index} onClick={()=>game.changeHint(index)}>
            {hint===index?'Hide':'Show'} hint {index+1}
          </Button>)}
        </div>
        {hint!==null&&<p className="puzzle-hint">{puzzle.hints[hint]}</p>}
        {feedback?.kind==='correct'&&<PuzzleSparks/>}
        <div className="puzzle-result" aria-live="polite" aria-atomic="true">
          {feedback?<p data-kind={feedback.kind}>{feedback.kind==='incorrect'?'Incorrect. ':''}{feedback.text}</p>:
            solved?<p data-kind="correct">Solved on {prettyDate(progress!.date)}.</p>:null}
        </div>
      </>:<p>Puzzle unavailable.</p>}
      {game.editions.length>0&&<label className="puzzle-archive">
        Edition
        <select value={puzzle?.id??''} onChange={event=>{
          const item=game.editions.find(entry=>entry.id===event.target.value)
          game.choose(item===game.editions[0]?undefined:item)
        }}>
          {!puzzle&&<option value="" disabled>Select a published puzzle</option>}
          {game.editions.map(entry=><option key={entry.id} value={entry.id}>{entry.region} · {entry.year}{entry===game.editions[0]?' (Latest)':''}</option>)}
        </select>
      </label>}
    </section>}
  </div>
}

