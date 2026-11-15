import { useEffect, useRef, type RefObject } from 'react'
import { OrbitalScene, type SpaceTransfer } from './orbitalScene'
import { spaceTransferOpacity } from './cameraTour'

export function SpaceCanvas({frame,transferRef,layerRef}:{
  frame:{width:number;height:number}
  transferRef:RefObject<SpaceTransfer|null>
  layerRef:RefObject<HTMLDivElement|null>
}) {
  const canvas=useRef<HTMLCanvasElement>(null)
  const scene=useRef<OrbitalScene|null>(null)

  useEffect(()=>{
    const element=canvas.current
    const layer=layerRef.current
    if(!element||!layer)return
    let id=0
    let contextLost=false
    let previous:SpaceTransfer|null=null
    const hide=()=>{
      layer.style.opacity='0'
      delete layer.dataset.scene
      delete layer.dataset.moon
    }
    const loseContext=(event:Event)=>{event.preventDefault();contextLost=true;hide()}
    const restoreContext=()=>{contextLost=false;previous=null}
    element.addEventListener('webglcontextlost',loseContext)
    element.addEventListener('webglcontextrestored',restoreContext)
    try{
      scene.current=new OrbitalScene(element)
    }catch{
      // Continue the existing map tour when a second WebGL context is unavailable.
      hide()
    }
    const draw=()=>{
      const transfer=transferRef.current
      if(transfer!==previous){
        const opacity=transfer?spaceTransferOpacity(transfer.progress):0
        if(transfer&&opacity>0&&scene.current&&!contextLost){
          scene.current.render(transfer)
          layer.style.opacity=String(opacity)
          layer.dataset.scene='earth'
          layer.dataset.moon=String(transfer.moon)
        }else hide()
        previous=transfer
      }
      id=requestAnimationFrame(draw)
    }
    if(scene.current)id=requestAnimationFrame(draw)
    return ()=>{
      cancelAnimationFrame(id)
      element.removeEventListener('webglcontextlost',loseContext)
      element.removeEventListener('webglcontextrestored',restoreContext)
      hide()
      scene.current?.dispose()
      scene.current=null
    }
  },[layerRef,transferRef])

  useEffect(()=>{
    scene.current?.resize(frame.width,frame.height)
  },[frame.width,frame.height])

  return <canvas ref={canvas} className="orbital-canvas" aria-hidden="true"/>
}

