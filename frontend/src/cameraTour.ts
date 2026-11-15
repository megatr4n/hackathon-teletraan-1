import { distance, scenarios, type Coord, type Focus, type MapBounds, type MapCell } from './data'
import { pillarHeightMeters } from './pillars'
import type { Camera } from './pins'

export type Shot = { to:Camera; ms:number; focusOnHotspots?:boolean }
type CameraTrack = { focus:Focus; arrival:Camera; moon:boolean; short:boolean; stop:number }
export type CameraCommand = { camera:Partial<Camera>; duration:number; bounds?:MapBounds } | { track:CameraTrack } |
  { globe:CameraDestination; startedAt:number; bounds?:MapBounds }
export type CameraDestination = Pick<Camera,'lon'|'lat'|'zoom'> & Partial<Camera>

const smooth=(t:number)=>t*t*(3-2*t)
const bearingDelta=(from:number,to:number)=>((to-from+540)%360)-180
const blend=(from:number,to:number,t:number)=>from+(to-from)*t
const wrapLongitude=(longitude:number)=>((longitude+180)%360+360)%360-180
const radians=Math.PI/180
export const compassBearing=(bearing:number)=>(bearing%360+360)%360

export function cameraBetween(from:Camera,to:Camera,t:number):Camera {
  const progress=smooth(Math.max(0,Math.min(1,t)))
  return {
    lat:blend(from.lat,to.lat,progress),lon:wrapLongitude(from.lon+bearingDelta(from.lon,to.lon)*progress),
    zoom:blend(from.zoom,to.zoom,progress),pitch:blend(from.pitch,to.pitch,progress),
    bearing:compassBearing(from.bearing+bearingDelta(from.bearing,to.bearing)*progress),
  }
}
export const transferDuration=7400
export const demoTransferDuration=950
const climbEnd=.37
const diveStart=.64
const phase=(progress:number,start:number,end:number)=>Math.min(1,Math.max(0,(progress-start)/(end-start)))

export function transferClimb(progress:number) {
  return smooth(phase(progress,0,climbEnd))
}

export function transferDescent(progress:number) {
  return smooth(phase(progress,diveStart,1))
}

export function spaceTransferOpacity(progress:number) {
  const fadeIn=smooth(phase(progress,.14,.31))
  const fadeOut=smooth(phase(progress,.83,.95))
  return fadeIn*(1-fadeOut)
}

export function transferCamera(from:Camera,arrival:Camera,progress:number):Camera {
  const climb=transferClimb(progress)
  const descent=transferDescent(progress)
  const travel=smooth(phase(progress,.09,.94))
  const [lon,lat]=interpolatePosition([from.lon,from.lat],[arrival.lon,arrival.lat],travel)
  return {
    lon,lat,
    zoom:blend(blend(from.zoom,1.55,climb),arrival.zoom,descent),
    pitch:blend(blend(from.pitch,8,climb),arrival.pitch,descent),
    bearing:compassBearing(from.bearing+bearingDelta(from.bearing,arrival.bearing)*travel),
  }
}

function view([lon,lat]:Coord,zoom:number,pitch:number,bearing:number):Camera {
  return {lon,lat,zoom,pitch,bearing:compassBearing(bearing)}
}
function interpolatePosition(from:Coord,to:Coord,fraction:number):Coord {
  if(fraction===0)return from
  if(fraction===1)return to
  const startLat=from[1]*radians, endLat=to[1]*radians
  const longitudeDelta=bearingDelta(from[0],to[0])*radians
  const east=Math.sin(longitudeDelta)*Math.cos(endLat)
  const north=Math.cos(startLat)*Math.sin(endLat)-Math.sin(startLat)*Math.cos(endLat)*Math.cos(longitudeDelta)
  const dot=Math.sin(startLat)*Math.sin(endLat)+Math.cos(startLat)*Math.cos(endLat)*Math.cos(longitudeDelta)
  const angle=Math.atan2(Math.hypot(east,north),dot)*fraction
  const heading=Math.atan2(east,north)
  const latitude=Math.asin(Math.max(-1,Math.min(1,Math.sin(startLat)*Math.cos(angle)+Math.cos(startLat)*Math.sin(angle)*Math.cos(heading))))
  const longitude=from[0]+Math.atan2(Math.sin(heading)*Math.sin(angle)*Math.cos(startLat),Math.cos(angle)-Math.sin(startLat)*Math.sin(latitude))/radians
  return [wrapLongitude(longitude),latitude/radians]
}
export const tourRegions=[scenarios[0],scenarios[1],scenarios[3],scenarios[2]]

export function cinematicTrack(focus:Focus,stop:number,short=false):CameraTrack {
  const bearings=[36,315,24,330]
  return {focus,arrival:view(focus.center,focus.zoom,39,bearings[stop]??36),moon:stop===1,short,stop}
}

export function hotspotShots(arrival:Camera,cells:readonly MapCell[],width:number,height:number,short=false):Shot[] {
  const detections=cells.flatMap(cell=>{
    const power=cell.raw??0
    return Number.isFinite(power)&&power>0?[{center:cell.center,power}]:[]
  }).sort((a,b)=>b.power-a.power)
  if(!detections.length)return [{to:{...arrival,bearing:compassBearing(arrival.bearing+26)},ms:short?900:2400}]

  // Choose a group with both strong FRP and enough neighboring detections to show depth.
  const radius=25
  let bestScore=0
  let target=detections[0].center
  let spread=0
  let peakPower=detections[0].power
  for(const candidate of detections.slice(0,24)){
    let score=0, extent=0, maxPower=0
    for(const cell of detections){
      const separation=distance(candidate.center,cell.center)
      if(separation>radius)continue
      score+=Math.sqrt(cell.power)*(1-.45*separation/radius)
      extent=Math.max(extent,separation)
      maxPower=Math.max(maxPower,cell.power)
    }
    if(score>bestScore){
      bestScore=score
      target=candidate.center
      spread=extent
      peakPower=maxPower
    }
  }

  const pitch=57
  const worldKm=2*Math.PI*6371*Math.cos(target[1]*radians)
  const groundZoom=Math.log2(worldKm*Math.min(width,height)*.29/(512*Math.max(5,spread)))
  const pillarKm=pillarHeightMeters(peakPower)/1000
  const heightZoom=Math.log2(worldKm*height*1.5*Math.cos(pitch*radians)/(512*Math.max(2,1.8*pillarKm)))
  const zoom=Math.max(1,Math.min(9.4,groundZoom,heightZoom))
  const near=view(target,zoom,pitch,arrival.bearing+22)
  if(short)return [
    {to:near,ms:450,focusOnHotspots:true},
    {to:view(target,zoom,54,near.bearing+44),ms:450,focusOnHotspots:true},
  ]
  const reveal=view(target,zoom,54,near.bearing+74)
  return [
    {to:near,ms:2500,focusOnHotspots:true},
    {to:reveal,ms:3350,focusOnHotspots:true},
    {to:reveal,ms:1200,focusOnHotspots:true},
    {to:view([arrival.lon,arrival.lat],arrival.zoom,37,near.bearing+96),ms:1600},
  ]
}
