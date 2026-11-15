import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { Slot } from '@radix-ui/react-slot'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useId, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?:boolean
  ref?:Ref<HTMLButtonElement>
  help?:string
}

// shadcn/ui's component pattern, with variants styled for this console.
export function Button({ asChild, className, type = 'button', help, ...props }:ButtonProps) {
  const Component = asChild ? Slot : 'button'
  if(help&&!asChild)return <HelpButton className={className} type={type} help={help} {...props}/>
  return <Component type={type} className={twMerge(clsx('button', className))} {...props} />
}

function HelpButton({help,children,className,onFocus,onBlur,onPointerEnter,onPointerLeave,onKeyDown,...props}:ButtonProps) {
  const id=useId()
  const [anchor,setAnchor]=useState<DOMRect|null>(null)
  const left=anchor?Math.max(8,Math.min(anchor.left+anchor.width/2-120,window.innerWidth-248)):0
  const above=anchor!==null&&anchor.bottom>window.innerHeight/2
  return <button {...props} className={twMerge(clsx('button',className))} aria-describedby={id}
    onFocus={event=>{setAnchor(event.currentTarget.getBoundingClientRect());onFocus?.(event)}}
    onBlur={event=>{setAnchor(null);onBlur?.(event)}}
    onPointerEnter={event=>{setAnchor(event.currentTarget.getBoundingClientRect());onPointerEnter?.(event)}}
    onPointerLeave={event=>{setAnchor(null);onPointerLeave?.(event)}}
    onKeyDown={event=>{if(event.key==='Escape')setAnchor(null);onKeyDown?.(event)}}>
    {children}<span id={id} hidden>{help}</span>
    {anchor&&createPortal(<span aria-hidden="true" className="help-tooltip" style={above?
      {left,bottom:window.innerHeight-anchor.top+6}:{left,top:anchor.bottom+6}}>{help}</span>,document.body)}
  </button>
}

export function InfoTip({label,help}:{label:string;help:string}) {
  return <Button className="info-tip" aria-label={label+' help'} help={help}><Info size={14}/></Button>
}

export const frpHelp='Fire radiative power (FRP) measures how much energy a fire radiates per second. It is reported in megawatts (MW).'
export const hotspotHelp='A hotspot is a satellite detection of unusual heat. One fire can produce several hotspot detections.'
export const zScoreHelp='The Z-score measures how far FRP is from its baseline in standard deviations. Positive values are above baseline.'

export function Segmented<T extends string>({ label, value, onChange, items, className }: {
  label: string
  value: T
  onChange: (value: T) => void
  items: { value: T; label: ReactNode }[]
  className?: string
}) {
  return <ToggleGroup.Root type="single" value={value} aria-label={label} className={clsx('segmented', className)}
    onValueChange={next => { if (next) onChange(next as T) }}>
    {items.map(item => <ToggleGroup.Item key={item.value} value={item.value} className="segment">{item.label}</ToggleGroup.Item>)}
  </ToggleGroup.Root>
}
