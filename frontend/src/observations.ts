import type { MultiPolygon, Polygon } from 'geojson'
import { contains, DAY, distance, doy, firstDate, iso, lastDate, offset, type Aoi, type Cell, type Focus } from './data'
import { addObservation, dateIndex, emptyObservation } from './estimates'

const formations=[[-40,15,5],[-22,23,13],[-13,3,12],[-1,-11,20],[9,3,20],[22,-4,18],[39,-12,16],[49,-26,10],[18,-26,10],[-30,-16,8],[0,30,11],[33,17,8],[61,-35,7]]
const origin=Date.parse(firstDate)
export const archiveDates=Array.from({length:dateIndex(lastDate,firstDate)+1},(_,i)=>iso(origin+i*DAY))

function noise(seed:number) {
  const value=Math.sin(seed*127.1+311.7)*43758.5453
  return value-Math.floor(value)
}

export function observations(focus:Focus,boundary?:Polygon|MultiPolygon,circle?:Extract<Aoi,{type:'circle'}>) {
  const scale=focus.id.startsWith('country:')?Math.min(4,2**(7.35-focus.zoom)):1
  const occupied=new Set<string>()
  const templates:Omit<Cell,'raw'>[]=[]
  const capacity=Math.max(4,focus.count)
  for(let i=0;templates.length<capacity && i<capacity*12;i++) {
    const [x,y,r]=formations[i%formations.length]
    const dx=Math.round((x*scale+(noise(i+9)-.5)*r*1.35*scale)/3)*3
    const dy=Math.round((y*scale+(noise(i+107)-.5)*r*1.3*scale)/3)*3
    const id=dx+'/'+dy
    if(occupied.has(id))continue
    occupied.add(id)
    templates.push({id,center:offset(focus.center,dx,dy),weight:.45+noise(i+222)**2.2*2.7+(i<13?3.5*noise(i+40):0),pass:noise(i+330)>.33?'day':'night'})
  }
  let weight=0
  const weights=templates.map(cell=>weight+=cell.weight)
  const filtered=templates.flatMap((cell,index)=>{
    const eligible=circle?distance(circle.center,cell.center)<=circle.radius:!boundary||contains(cell.center,boundary)
    return eligible?[index]:[]
  })
  const focusTime=Date.parse(focus.date)
  function setupDay(date:string) {
    const delta=Math.abs(Date.parse(date)-focusTime)/DAY
    const factor=delta===0?1:.17+.46*Math.exp(-delta/29)+.31*noise(doy(date)+Number(date.slice(0,4)))
    const count=Math.min(templates.length,Math.max(4,Math.round(focus.count*factor)))
    return {count,multiplier:weights[count-1]?focus.raw*factor/weights[count-1]:0}
  }
  function cellsForDay(date:string) {
    const {count,multiplier}=setupDay(date)
    const cells:Cell[]=[]
    for(const index of filtered) {
      if(index>=count)break
      const cell=templates[index]
      cells.push({...cell,raw:cell.weight*multiplier})
    }
    return cells
  }
  function history() {
    return archiveDates.map(date=>{
      const {count,multiplier}=setupDay(date)
      const daily=emptyObservation()
      for(const index of filtered) {
        if(index>=count)break
        const cell=templates[index]
        addObservation(daily,{...cell,raw:cell.weight*multiplier})
      }
      return daily
    })
  }
  return {cellsForDay,history}
}
