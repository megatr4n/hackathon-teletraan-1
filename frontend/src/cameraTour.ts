import { distance, offset, scenarios, type Cell, type Coord, type Focus } from './data'
import { observations } from './observations'
import type { Camera } from './pins'

type Easing = 'linear' | 'smooth' | 'accelerate' | 'decelerate'
export type Shot = { to:Camera; ms:number; ease?:Easing; sweep?:number }
type FlightPose = { position:Coord; altitude:number; pitch:number; bearing:number }
type Flight = { duration:number; at:(progress:number)=>FlightPose }
type SpaceLeg = { moon?:boolean }
export type CameraTrack = { flight:Flight; transfer?:SpaceLeg } | { shots:Shot[]; arrival:Camera; transfer:SpaceLeg }
export type CameraCommand = { camera:Partial<Camera>; duration:number } | { track:CameraTrack } | { globe:Pick<Camera,'lon'|'lat'|'zoom'>; startedAt:number }

const easing:Record<Easing,(t:number)=>number>={
  linear:t=>t,
  smooth:t=>t*t*(3-2*t),
  accelerate:t=>t**2.25,
  decelerate:t=>1-(1-t)**2.5,
}
const bearingDelta=(from:number,to:number)=>((to-from+540)%360)-180
const blend=(from:number,to:number,t:number)=>from+(to-from)*t
const wrapLongitude=(longitude:number)=>((longitude+180)%360+360)%360-180
const radians=Math.PI/180
export const compassBearing=(bearing:number)=>(bearing%360+360)%360

export function cameraBetween(from:Camera,to:Camera,t:number,ease:Easing='smooth',sweep?:number):Camera {
  const progress=easing[ease](Math.max(0,Math.min(1,t)))
  return {
    lat:blend(from.lat,to.lat,progress),lon:wrapLongitude(from.lon+bearingDelta(from.lon,to.lon)*progress),
    zoom:blend(from.zoom,to.zoom,progress),pitch:blend(from.pitch,to.pitch,progress),
    bearing:compassBearing(from.bearing+(sweep??bearingDelta(from.bearing,to.bearing))*progress),
  }
}
export const transferDuration=7400
const lowFlightEnd=.16
const climbEnd=.40
const diveStart=.70
const fadeEnd=.98
const phase=(progress:number,start:number,end:number)=>Math.min(1,Math.max(0,(progress-start)/(end-start)))

export function transferClimb(progress:number) {
  return easing.smooth(phase(progress,lowFlightEnd,climbEnd))
}

export function transferDescent(progress:number) {
  return easing.smooth(phase(progress,diveStart,1))
}

export function spaceTransferOpacity(progress:number) {
  const fadeIn=easing.smooth(phase(progress,lowFlightEnd+.05,climbEnd-.035))
  const fadeOut=easing.smooth(phase(progress,diveStart+.095,fadeEnd))
  return fadeIn*(1-fadeOut)
}

export function transferCamera(from:Camera,arrival:Camera,lowZoom:number,progress:number):Camera {
  const lowFlight=phase(progress,0,lowFlightEnd)
  const climb=transferClimb(progress)
  const descent=transferDescent(progress)
  const departure=around([from.lon,from.lat],95*lowFlight,from.bearing)
  const cruise=phase(progress,lowFlightEnd,1)
  // Start turning during the climb, keep moving around Earth, and finish turning during the dive.
  const travel=.42*cruise+.58*easing.smooth(cruise)
  const [lon,lat]=interpolatePosition(departure,[arrival.lon,arrival.lat],travel)
  const lowPitch=blend(from.pitch,cruisePitch,easing.smooth(lowFlight))
  return {
    lon,lat,
    zoom:blend(blend(blend(from.zoom,lowZoom,easing.smooth(lowFlight)),1.65,climb),arrival.zoom,descent),
    pitch:blend(blend(lowPitch,7,climb),arrival.pitch,descent),
    bearing:compassBearing(from.bearing+bearingDelta(from.bearing,arrival.bearing)*easing.smooth(cruise)),
  }
}

function view([lon,lat]:Coord,zoom:number,pitch:number,bearing:number):Camera {
  return {lon,lat,zoom,pitch,bearing:compassBearing(bearing)}
}
function interpolatePosition(from:Coord,to:Coord,t:number):Coord {
  return [wrapLongitude(from[0]+bearingDelta(from[0],to[0])*t),blend(from[1],to[1],t)]
}
function around(center:Coord,radius:number,bearing:number):Coord {
  return offset(center,radius*Math.sin(bearing*radians),radius*Math.cos(bearing*radians))
}
function closestStrongPillar(focus:Focus,cells:Cell[]) {
  return [...cells].sort((a,b)=>distance(a.center,focus.center)-distance(b.center,focus.center))
    .slice(0,28).sort((a,b)=>b.raw-a.raw)[0]?.center??focus.center
}

// The demo pillars sit on a 3 km grid and each footprint extends 720 m on either side.
// Keep the slalom inside the gap between two rows picked using the strongest nearby pillar.
function firstFlightLane(focus:Focus,cells:Cell[]) {
  const pillar=closestStrongPillar(focus,cells)
  const latitude=offset(pillar,0,1.5)[1]
  const center:Coord=[focus.center[0],latitude]
  const east=Math.max(center[0],...cells.map(cell=>cell.center[0]))
  const west=Math.min(center[0],...cells.map(cell=>cell.center[0]))
  return { entry:offset([east,latitude],60,0), exit:offset([west,latitude],-32,0), east, west }
}

const lowAltitude=2100
const cruiseAltitude=3600
const cruisePitch=76
const approachDuration=7450
const reverseViewDuration=1650
const turnBackDuration=1250

function firstRegionFlight(focus:Focus):Flight {
  const {entry,exit,east,west}=firstFlightLane(focus,observations(focus).cellsForDay(focus.date))
  const laneWidth=east-west
  const laneLength=distance([east,entry[1]],[west,entry[1]])
  const longitudeSpan=entry[0]-exit[0]
  const timeAtLane=(fraction:number)=>{
    const travel=(entry[0]-blend(east,west,fraction))/longitudeSpan
    return approachDuration*(Math.sqrt(.44**2+4*.56*travel)-.44)/(2*.56)
  }
  const turnStart=timeAtLane(.4)
  const revealStart=timeAtLane(.84)
  const revealEnd=revealStart+reverseViewDuration
  const duration=revealEnd+turnBackDuration
  const altitudeDuringReveal=27500

  return {duration,at:progress=>{
    const time=progress*duration
    const t=time/approachDuration
    const travel=t<=1?t*(.44+.56*t):1+1.56*(t-1)
    const longitude=entry[0]-longitudeSpan*travel
    const laneProgress=laneWidth>0?Math.max(0,Math.min(1,(east-longitude)/laneWidth)):0
    const phase=laneProgress*6*Math.PI
    const envelope=Math.sin(laneProgress*Math.PI)**2
    const wave=Math.sin(phase)
    const sway=.65*envelope*wave
    const slope=.65*Math.PI*(Math.sin(2*Math.PI*laneProgress)*wave+6*envelope*Math.cos(phase))/Math.max(1,laneLength)
    const position=offset([longitude,entry[1]],0,sway)
    if(time<turnStart){
      const descent=easing.smooth(Math.min(t/.55,1))
      const altitude=blend(900000,lowAltitude,descent)
      const ahead=blend(41000,lowAltitude*Math.tan(cruisePitch*radians),descent)
      return {position,altitude,pitch:Math.atan2(ahead,altitude)/radians,bearing:270+Math.atan(slope)/radians}
    }

    const firstTurn=easing.smooth(Math.min(1,(time-turnStart)/(revealStart-turnStart)))
    const secondTurn=easing.smooth(Math.max(0,(time-revealEnd)/turnBackDuration))
    const ascent=easing.smooth(Math.min(1,(time-turnStart)/(revealEnd-turnStart)))
    const altitude=blend(blend(lowAltitude,altitudeDuringReveal,ascent),cruiseAltitude,secondTurn)
    const lookBackPitch=Math.min(cruisePitch,Math.atan2(distance(position,focus.center)*1000,altitude)/radians)
    const pitch=blend(blend(cruisePitch,lookBackPitch,firstTurn),cruisePitch,secondTurn)
    const bearing=270-180*firstTurn-180*secondTurn+(1-firstTurn)*Math.atan(slope)/radians
    return {position,altitude,pitch,bearing:compassBearing(bearing)}
  }}
}
// Retain Australia as the third stop and add the remaining built-in pin afterwards.
export const tourRegions=[scenarios[0],scenarios[1],scenarios[3],scenarios[2]]

export function cinematicTrack(focus:Focus,stop:number):CameraTrack {
  if(stop===0){
    return {flight:firstRegionFlight(focus)}
  }
  if(stop===1){
    const orbitRadius=67
    const orbitAltitude=orbitRadius*1000
    return {transfer:{moon:true},flight:{duration:6250,at:progress=>{
      if(progress<.32){
        const t=progress/.32
        return {position:around(focus.center,blend(195,orbitRadius,t*(2-t)),90-10*t),altitude:blend(26000,orbitAltitude,easing.decelerate(t)),pitch:blend(64,45,easing.smooth(t)),bearing:270-10*t}
      }
      const orbit=(progress-.32)/.68
      const angle=80+155*orbit
      // Keep the first half of the right-hand orbit at 45°, then open into a wider reveal.
      const pullback=easing.smooth(Math.max(0,(orbit-.53)/.47))
      const radius=orbitRadius+27*pullback
      const altitude=orbitAltitude+49000*pullback
      return {position:around(focus.center,radius,angle),altitude,pitch:Math.atan2(radius*1000,altitude)/radians,bearing:angle+180}
    }}}
  }
  const first=closestStrongPillar(focus,observations(focus).cellsForDay(focus.date))
  if(stop===3){
    const glancing=view(offset(first,-37,23),9.2,67,119)
    return {transfer:{},arrival:view(offset(focus.center,-380,210),6.5,47,113),shots:[
      {to:glancing,ms:2050,ease:'accelerate'},
      {to:view(offset(first,27,5),8.4,55,180),ms:1850,ease:'linear',sweep:61},
      {to:view(offset(first,6,-24),7.9,49,286),ms:1950,ease:'linear',sweep:106},
      {to:view(offset(focus.center,30,13),5.6,29,350),ms:2300,ease:'decelerate'},
    ]}
  }
  const bank=view(offset(first,-34,-12),8.55,61,142)
  return {transfer:{},arrival:view(offset(focus.center,-225,-105),6.5,52,112),shots:[
    {to:bank,ms:1800,ease:'accelerate'},
    {to:view(offset(first,20,-15),8.25,53,250),ms:2000,ease:'linear',sweep:108},
    {to:view(offset(first,33,24),7.4,45,350),ms:2050,ease:'linear',sweep:100},
    {to:view(focus.center,6.6,48,80),ms:1750,ease:'decelerate',sweep:90},
  ]}
}
