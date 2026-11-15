import { useEffect, useRef } from 'react'

export function StarField({width,height}:{width:number;height:number}) {
  const canvas=useRef<HTMLCanvasElement>(null)
  useEffect(()=>{
    const context=canvas.current?.getContext('2d')
    if(!context||!width||!height)return
    context.clearRect(0,0,width,height)
    let seed=24713
    const random=()=>{
      seed=(Math.imul(1664525,seed)+1013904223)>>>0
      return seed/2**32
    }
    const count=Math.round(width*height/355)
    for(let index=0;index<count;index++){
      const x=random()*width
      const y=random()*height
      const radius=.33+.62*random()**2
      const topFade=1-.43*y/height
      const opacity=(.16+random()*.64)*topFade
      context.fillStyle='rgba(217,232,255,'+opacity+')'
      context.beginPath()
      context.arc(x,y,radius,0,Math.PI*2)
      context.fill()
    }
  },[width,height])
  return <canvas className="map-stars" aria-hidden="true" ref={canvas} width={width} height={height}/>
}

