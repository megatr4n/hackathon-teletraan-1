import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import maplibregl, { type GeoJSONSource, type RasterTileSource, type StyleSpecification } from 'maplibre-gl'
import { Box, Grid3X3, Layers3, Map as MapIcon, Minus, Plus, Ruler, Satellite, Target } from 'lucide-react'
import type { FeatureCollection, Geometry } from 'geojson'
import { areaPolygon, cellPolygon, contains, coord, distance, offset, type Aoi, type MapCell, type Coord, type Focus } from './data'
import { FirePillars } from './pillars'
import { Button, InfoTip, frpHelp } from './ui'
import { asset, type AreaMode, type RegionCollection, type RegionFeature } from './geography'
import { initialSnapshot, type Camera, type MapOptions } from './pins'

import { cameraBetween, transferCamera, transferDuration, type CameraCommand } from './cameraTour'
import { StarField } from './StarField'
import type { SpaceTransfer } from './orbitalScene'

const SpaceCanvas = lazy(() => import('./SpaceCanvas').then(module => ({default:module.SpaceCanvas})))
let keplerModule:Promise<typeof import('./kepler')>|undefined
function loadKepler() {
  return keplerModule??=import('./kepler')
}
const KeplerMap = lazy(() => loadKepler().then(module => ({default:module.KeplerMap})))

export type Tool = 'circle' | 'lasso' | null
type Props = {
  focus:Focus; date:string; cells:MapCell[]; weekly:boolean; aoi:Aoi|null; tool:Tool;
  onArea:(area:Aoi)=>void; onCirclePreviewRadius:(radius:number|null)=>void;
  command:CameraCommand|null; onCamera:(camera:Camera)=>void;
  options:MapOptions; onOptions:(options:MapOptions)=>void;
  countries:RegionCollection; admins:RegionCollection; ecoregions:RegionCollection; areaMode:AreaMode;
  selected:RegionFeature|undefined; onRegion:(region:RegionFeature,point?:Coord)=>void;
  measuring:boolean; orbiting:boolean; onTourEnd:()=>void; historical:boolean;
}
const empty: FeatureCollection = {type:'FeatureCollection',features:[]}
const satelliteTiles = (date:string) => 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/'+date+'/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'
const collection = (features:FeatureCollection['features']): FeatureCollection => ({type:'FeatureCollection',features})
const labels: { name:string; point:Coord; type?:string }[] = [
  {name:'B E L A R U S',point:[29.8,52.23],type:'country'}, {name:'U K R A I N E',point:[29.45,50.57],type:'country'},
  {name:'Pinsk',point:[26.10,52.10]}, {name:'Mazyr',point:[29.27,52.05]}, {name:'Homiel',point:[31,52.44]},
  {name:'Naroulia',point:[29.50,51.80]}, {name:'Ovruch',point:[28.80,51.32]}, {name:'Slavutych',point:[30.77,51.53]},
  {name:'Chernihiv',point:[31.29,51.49]}, {name:'Korosten',point:[28.64,50.95]}, {name:'Kyiv',point:[30.52,50.45]},
  {name:'D N I P R O',point:[30.61,50.80],type:'river'}, {name:'P R I P Y A T',point:[28.71,51.86],type:'river'},
]
function mapStyle(): StyleSpecification {
  return {version:8,sources:{
    countries:{type:'geojson',data:empty},
    worldRelief:{type:'image',url:asset('global.webp'),coordinates:[[-180,tileLat(0)],[180,tileLat(0)],[180,tileLat(256)],[-180,tileLat(256)]]},
    relief:{type:'image',url:asset('tactical.webp'),coordinates:[ [143/256*360-180, tileLat(80)], [158/256*360-180,tileLat(80)], [158/256*360-180,tileLat(91)], [143/256*360-180,tileLat(91)] ]},
    hydrology:{type:'geojson',data:asset('hydrology.json')},
    satellite:{type:'raster',tiles:[satelliteTiles('2020-04-14')],tileSize:256,maxzoom:9,attribution:'NASA EOSDIS GIBS'},
    grid:{type:'geojson',data:empty},
    fires:{type:'geojson',data:empty},
    fireCenters:{type:'geojson',data:empty},
    hazard:{type:'geojson',data:empty},
    area:{type:'geojson',data:empty},
    circlePreview:{type:'geojson',data:empty},
    target:{type:'geojson',data:empty},
    admins:{type:'geojson',data:empty},
    eco:{type:'geojson',data:empty},
    parks:{type:'geojson',data:asset('geography/protected.json')},
    globalParks:{type:'raster',tileSize:256,minzoom:3,maxzoom:12,tiles:[
      'https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:1&layerDefs=%7B%221%22%3A%22iucn_cat%3D%27II%27%22%7D&f=image'
    ]},
    peatWest:{type:'image',url:asset('geography/peat-west.png'),coordinates:[[-179.75,78],[0,78],[0,-72],[-179.75,-72]]},
    peatEast:{type:'image',url:asset('geography/peat-east.png'),coordinates:[[0,78],[179.75,78],[179.75,-72],[0,-72]]},
  },layers:[
    {id:'ocean',type:'background',paint:{'background-color':'#0a111a','background-opacity':.88}},
    {id:'land',type:'fill',source:'countries',paint:{'fill-color':'#171f25'}},
    {id:'world-relief',type:'raster',source:'worldRelief',paint:{'raster-fade-duration':0}},
    {id:'tactical',type:'raster',source:'relief',paint:{'raster-fade-duration':0}},
    {id:'sat',type:'raster',source:'satellite',layout:{visibility:'none'},paint:{'raster-fade-duration':150,'raster-brightness-max':.72}},
    {id:'lakes',type:'fill',source:'hydrology',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#132735','fill-opacity':.86}},
    {id:'rivers',type:'line',source:'hydrology',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#3b586b','line-width':['interpolate',['linear'],['zoom'],4,.35,8,1.2],'line-opacity':.68}},
    {id:'peat-west',type:'raster',source:'peatWest',layout:{visibility:'none'},paint:{'raster-opacity':.78,'raster-fade-duration':0}},
    {id:'peat-east',type:'raster',source:'peatEast',layout:{visibility:'none'},paint:{'raster-opacity':.78,'raster-fade-duration':0}},
    {id:'global-parks',type:'raster',source:'globalParks',layout:{visibility:'none'},paint:{'raster-opacity':.55}},
    {id:'protected-fill',type:'fill',source:'parks',layout:{visibility:'none'},paint:{'fill-color':['match',['get','kind'],'exclusion','#d0b581','#72c889'],'fill-opacity':.18}},
    {id:'protected-line',type:'line',source:'parks',layout:{visibility:'none'},paint:{'line-color':['match',['get','kind'],'exclusion','#e4c990','#7cdb91'],'line-width':1.25}},
    {id:'country-hit',type:'fill',source:'countries',paint:{'fill-color':'#3d6b91','fill-opacity':0}},
    {id:'admin-hit',type:'fill',source:'admins',paint:{'fill-color':'#60add3','fill-opacity':.045}},
    {id:'admin-line',type:'line',source:'admins',paint:{'line-color':'#6797b6','line-opacity':.62,'line-width':.8,'line-dasharray':[2,2]}},
    {id:'eco-hit',type:'fill',source:'eco',paint:{'fill-color':'#69ae94','fill-opacity':.065}},
    {id:'eco-line',type:'line',source:'eco',paint:{'line-color':'#76b298','line-opacity':.55,'line-width':.8}},
    {id:'boundaries',type:'line',source:'countries',paint:{'line-color':'#586575','line-opacity':.63,'line-width':1.1,'line-dasharray':[4,3]}},
    {id:'cell-grid',type:'line',source:'grid',paint:{'line-color':'#e19350','line-width':.65,'line-opacity':.38}},
    {id:'hazard-fill',type:'fill',source:'hazard',paint:{'fill-color':'#ef672b','fill-opacity':.048}},
    {id:'hazard-contour',type:'line',source:'hazard',paint:{'line-color':['case',['==',['get','z'],2.5],'#f18845','#aa5e45'],'line-width':['case',['==',['get','z'],2.5],1.25,.9],'line-dasharray':[4,3],'line-opacity':.9}},
    {id:'area-fill',type:'fill',source:'area',paint:{'fill-color':'#4ac7e8','fill-opacity':.08}},
    {id:'area-outline',type:'line',source:'area',paint:{'line-color':'#5ed1ec','line-width':1.2,'line-opacity':.74,'line-dasharray':[3,2]}},
    {id:'circle-preview-fill',type:'fill',source:'circlePreview',paint:{'fill-color':'#4ac7e8','fill-opacity':.08}},
    {id:'circle-preview-line',type:'line',source:'circlePreview',paint:{'line-color':'#65d7f3','line-width':1.35,'line-dasharray':[3,2]}},
    {id:'fire-footprint',type:'fill',source:'fires',paint:{'fill-color':['interpolate',['linear'],['get','power'],0,'#8c3626',35,'#e65c2b',140,'#ffa354'],'fill-opacity':.85}},
    {id:'fire-centers',type:'circle',source:'fireCenters',maxzoom:8,paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,1.3,5,2.1,8,2.5],'circle-color':'#fb883f','circle-opacity':.82}},
    {id:'crosshair',type:'line',source:'target',paint:{'line-color':'#e69b61','line-width':1.15,'line-opacity':.75}},
  ]}
}
function tileLat(y:number) { return Math.atan(Math.sinh(Math.PI * (1-2*y/256))) * 180 / Math.PI }
function hazardShape(center:Coord,x:number,y:number,rx:number,ry:number,z:number) {
  const angles = Array.from({length:25},(_,i)=>i*Math.PI/12)
  const ring = angles.map(a=>offset(center,x+Math.cos(a)*rx*(1+.12*Math.cos(a*5)+.09*Math.sin(a*7)), y+Math.sin(a)*ry*(1+.12*Math.sin(a*6))))
  return {type:'Feature' as const,properties:{z},geometry:{type:'Polygon' as const,coordinates:[[...ring,ring[0]]]}}
}

export function MapStage({focus,date,cells,weekly,aoi,tool,onArea,onCirclePreviewRadius,command,onCamera,options,onOptions,
  countries,admins,ecoregions,areaMode,selected,onRegion,measuring,orbiting,onTourEnd,historical}:Props) {
  const holder=useRef<HTMLDivElement>(null), map=useRef<maplibregl.Map|null>(null)
  const fire=useRef<FirePillars|null>(null), places=useRef<maplibregl.Marker[]>([])
  const [ready,setReady]=useState(false)
  const [camera,setCamera]=useState(initialSnapshot.camera)
  const [size,setSize]=useState({width:0,height:0})
  const [trace,setTrace]=useState<[number,number][]>([])
  const [segments,setSegments]=useState<[Coord,Coord][]>([])
  const [draft,setDraft]=useState<[Coord,Coord]|null>(null)
  const lasso=useRef<{points:Coord[]; path:[number,number][]}|null>(null)
  const circleDrag=useRef<{pointerId:number;center:Coord;start:[number,number];preview:GeoJSONSource}|null>(null)
  const [circleLine,setCircleLine]=useState<[Coord,Coord]|null>(null)
  const ruler=useRef<Coord|null>(null)
  const [regionFlying,setRegionFlying]=useState(false)
  const [cameraToApply,setCameraToApply]=useState<CameraCommand|null>(null)
  const animation=useRef<number>(0)
  const spaceLayer=useRef<HTMLDivElement>(null)
  const transferRef=useRef<SpaceTransfer|null>(null)
  const cameraFrame=useRef(0)
  const previous=useRef<Camera>(camera)
  const commandedCamera=useRef<Camera|null>(null)
  const callbacks=useRef({onCamera,onRegion,areaMode,onTourEnd})
  callbacks.current={onCamera,onRegion,areaMode,onTourEnd}
  const style=useMemo(mapStyle,[])

  const changeCamera=useCallback((camera:Partial<Camera>,duration=0)=>setCameraToApply({camera,duration}),[])
  useEffect(()=>{ if(command) setCameraToApply(command) },[command])

  useEffect(()=>{
    if(!holder.current) return
    const observer=new ResizeObserver(([entry])=>{
      const {width,height}=entry.contentRect
      setSize({width:Math.floor(width),height:Math.floor(height)})
    })
    observer.observe(holder.current)
    return ()=>observer.disconnect()
  },[])

  const bindMap=useCallback((instance:maplibregl.Map)=>{
    if(map.current===instance) return
    map.current=instance
    const init=()=>{
      if(map.current!==instance || instance.getLayer('fire-pillars')) return
      const layer=new FirePillars()
      instance.addLayer(layer)
      fire.current=layer
      setReady(true)
    }
    if(instance.isStyleLoaded()) init()
    else instance.once('load',init)
    const syncCamera=()=>{
      if(cameraFrame.current)return
      cameraFrame.current=requestAnimationFrame(()=>{
        cameraFrame.current=0
        const {lat,lng}=instance.getCenter().wrap()
        const next={lat,lon:lng,zoom:instance.getZoom(),bearing:(instance.getBearing()+360)%360,pitch:instance.getPitch()}
        const prior=previous.current
        if(next.lat===prior.lat&&next.lon===prior.lon&&next.zoom===prior.zoom&&next.bearing===prior.bearing&&next.pitch===prior.pitch)return
        previous.current=next
        setCamera(next)
        callbacks.current.onCamera(next)
      })
    }
    instance.on('move',syncCamera)
    instance.once('remove',()=>{
      cancelAnimationFrame(cameraFrame.current)
      cameraFrame.current=0
    })
    syncCamera()
  },[])

  useEffect(()=>{
    const instance=map.current
    if(!cameraToApply||!ready||!instance) return
    const request=cameraToApply
    const globe='globe' in request?request.globe:null
    const track='track' in request?request.track:null
    if(track&&!orbiting)return
    let active=true
    setRegionFlying(globe!==null)
    void loadKepler().then(({setKeplerCamera})=>{
      if(!active)return
      let last=(orbiting?commandedCamera.current:null)??previous.current
      const applyFrame=(camera:Camera)=>{
        last=camera
        commandedCamera.current=camera
        setKeplerCamera(camera)
      }
      const basedOnFlight=track&&'flight' in track?track.flight:null
      const toMapCamera=(pose:ReturnType<NonNullable<typeof basedOnFlight>['at']>):Camera=>{
        const {position,altitude,bearing,pitch}=pose
        const options=instance.calculateCameraOptionsFromCameraLngLatAltRotation(position,altitude,bearing,pitch)
        const center=maplibregl.LngLat.convert(options.center!).wrap()
        return {lat:center.lat,lon:center.lng,zoom:options.zoom??last.zoom,bearing,pitch}
      }
      const transfer=globe?{moon:false}:track?.transfer
      const arrival=globe?{...last,...globe}:basedOnFlight?toMapCamera(basedOnFlight.at(0)):track&&'arrival' in track?track.arrival:null
      const shots=track&&'shots' in track?track.shots:'camera' in request?[{to:{...last,...request.camera},ms:request.duration}]:[]
      const startTime='globe' in request?request.startedAt:performance.now()
      const transferTime=globe?3500:transfer?transferDuration:0
      const lowZoom=transfer?toMapCamera({
        position:[last.lon,last.lat],altitude:3600,bearing:last.bearing,pitch:76,
      }).zoom:last.zoom
      const regionalDuration=basedOnFlight?.duration??shots.reduce((sum,shot)=>sum+shot.ms,0)
      const totalDuration=transferTime+regionalDuration
      const origin=last
      const regionalStart=arrival??last

      const tick=(now:number)=>{
        const elapsed=Math.min(totalDuration,Math.max(0,now-startTime))
        if(transfer&&arrival&&elapsed<transferTime){
          const progress=elapsed/transferTime
          const camera=transferCamera(origin,arrival,lowZoom,progress)
          transferRef.current={moon:transfer.moon??false,progress,camera,viewportHeight:instance.getCanvas().clientHeight}
          applyFrame(camera)
        }else{
          transferRef.current=null
          const timeInRegion=elapsed-transferTime
          if(globe&&arrival){
            applyFrame(arrival)
          }else if(basedOnFlight){
            applyFrame(toMapCamera(basedOnFlight.at(timeInRegion/basedOnFlight.duration)))
          }else{
            let from=regionalStart
            let remaining=timeInRegion
            for(const shot of shots){
              if(remaining<=shot.ms){
                applyFrame(cameraBetween(from,shot.to,shot.ms===0?1:remaining/shot.ms,shot.ease,shot.sweep))
                break
              }
              remaining-=shot.ms
              from=shot.to
            }
          }
        }
        if(elapsed<totalDuration)animation.current=requestAnimationFrame(tick)
        else{
          if(track)callbacks.current.onTourEnd()
          else {
            commandedCamera.current=null
            if(globe)setRegionFlying(false)
          }
        }
      }
      if(basedOnFlight&&!transfer)applyFrame(toMapCamera(basedOnFlight.at(0)))
      if(globe||basedOnFlight||shots.length)animation.current=requestAnimationFrame(tick)
    })
    return ()=>{
      active=false
      cancelAnimationFrame(animation.current)
      transferRef.current=null
      spaceLayer.current?.style.setProperty('opacity','0')
    }
  },[cameraToApply,ready,orbiting])
  useEffect(()=>{
    const instance=map.current
    if (!ready || !instance) return
    places.current.forEach(marker=>marker.remove())
    const activeLabels=focus.id==='chernobyl'?labels:[]
    places.current=activeLabels.map(label=>{
      const el=document.createElement('span')
      el.className='map-label '+(label.type ?? 'city')
      el.textContent=label.name
      return new maplibregl.Marker({element:el}).setLngLat(label.point).addTo(instance)
    })
    const el=document.createElement('span')
    el.className='map-focus-label'
    el.innerHTML='<i></i><span></span>'
    el.querySelector('span')!.textContent=focus.name.toUpperCase()
    places.current.push(new maplibregl.Marker({element:el,anchor:'bottom',offset:[0,-25]}).setLngLat(focus.center).addTo(instance))
    return ()=>places.current.forEach(marker=>marker.remove())
  },[focus,ready])

  useEffect(()=>{
    const instance=map.current
    if (!ready || !instance) return
    const set=(name:string,data:FeatureCollection<Geometry>)=>(instance.getSource(name) as GeoJSONSource).setData(data)
    set('grid',collection(cells.map(cell=>cellPolygon(cell))))
    set('fires',collection(cells.flatMap(cell=>{
      if(cell.raw===null)return []
      const item=cellPolygon(cell,.72)
      return {...item,properties:{...item.properties,power:cell.raw}}
    })))
    set('fireCenters',collection(historical?cells.map(cell=>({type:'Feature',properties:{},
      geometry:{type:'Point',coordinates:cell.center}})):[]))
    const hazards = !historical && cells.length ? [hazardShape(focus.center,6,-1,64,40,1.5),hazardShape(focus.center,-12,13,24,13,2.5),hazardShape(focus.center,25,-12,31,16,2.5)] : []
    set('hazard',collection(hazards))
    set('area',collection(aoi ? [{type:'Feature',geometry:areaPolygon(aoi),properties:{}}] : selected ? [selected] : []))
    set('target',collection([{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:[
      [offset(focus.center,-4,0),offset(focus.center,-1.7,0)],[offset(focus.center,1.7,0),offset(focus.center,4,0)],
      [offset(focus.center,0,-4),offset(focus.center,0,-1.7)],[offset(focus.center,0,1.7),offset(focus.center,0,4)],
    ]}}]))
    fire.current?.update(cells)
  },[cells,focus,ready,aoi,selected,historical])

  useEffect(()=>{
    const instance=map.current
    if (!ready || !instance) return
    const set=(name:string,data:RegionCollection)=>(instance.getSource(name) as GeoJSONSource).setData(data)
    set('countries',countries)
    set('admins',areaMode==='countries'?admins:{type:'FeatureCollection',features:[]})
    set('eco',areaMode==='ecoregions'?ecoregions:{type:'FeatureCollection',features:[]})
  },[countries,admins,ecoregions,areaMode,ready])

  useEffect(()=>{
    const instance=map.current
    if(!ready||!instance) return
    const visibility=(id:string,show:boolean)=>instance.setLayoutProperty(id,'visibility',show?'visible':'none')
    visibility('cell-grid',options.grid)
    visibility('sat',options.satellite)
    for(const layer of ['lakes','rivers'])visibility(layer,!options.satellite)
    for(const layer of ['peat-west','peat-east','global-parks','protected-line','protected-fill'])visibility(layer,options.ecosystems)
    if(options.satellite)(instance.getSource('satellite') as RasterTileSource).setTiles([satelliteTiles(date)])
  },[options,date,ready])

  useEffect(()=>{
    if(!measuring){setSegments([]);setDraft(null);ruler.current=null}
  },[measuring])

  const clearCircle=useCallback(()=>{
    const drag=circleDrag.current
    if(!drag)return
    drag.preview.setData(empty)
    circleDrag.current=null
    setCircleLine(null)
    onCirclePreviewRadius(null)
  },[onCirclePreviewRadius])

  useEffect(()=>{
    if(tool!=='circle')clearCircle()
  },[tool,clearCircle])

  function drawPoint(event:PointerEvent<HTMLDivElement>) {
    const bounds=event.currentTarget.getBoundingClientRect()
    const point:[number,number]=[event.clientX-bounds.left,event.clientY-bounds.top]
    const result=map.current?.unproject(point).wrap()
    return result ? {point,location:[result.lng,result.lat] as Coord} : null
  }
  function startMeasure(event:PointerEvent<HTMLDivElement>) {
    if(event.button!==0)return
    const entry=drawPoint(event)
    if(!entry)return
    event.currentTarget.setPointerCapture(event.pointerId)
    ruler.current=entry.location
    setDraft([entry.location,entry.location])
  }
  function extendMeasure(event:PointerEvent<HTMLDivElement>) {
    if(!ruler.current)return
    const entry=drawPoint(event)
    if(entry)setDraft([ruler.current,entry.location])
  }
  function finishMeasure(event:PointerEvent<HTMLDivElement>) {
    const start=ruler.current, entry=drawPoint(event)
    if(start&&entry&&distance(start,entry.location)>.01)setSegments(values=>[...values,[start,entry.location]])
    ruler.current=null
    setDraft(null)
  }
  const pointer=useRef<{x:number;y:number}|null>(null)
  function selectAtPoint(event:PointerEvent<HTMLDivElement>) {
    const origin=pointer.current
    pointer.current=null
    if (!origin || event.button!==0 || event.shiftKey || event.ctrlKey || tool || measuring || areaMode==='custom' ||
      Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>5) return
    const entry=drawPoint(event)
    if(!entry||!ready||!map.current)return
    const layers=areaMode==='ecoregions'?['eco-hit']:['admin-hit','country-hit']
    const hit=map.current.queryRenderedFeatures(entry.point,{layers})
    const visible=hit.find(item=>item.layer.id==='admin-hit')??hit[0]
    const candidates=areaMode==='ecoregions'?ecoregions.features:[...admins.features,...countries.features]
    const feature=(visible&&candidates.find(item=>item.properties.id===visible.properties.id))
      ||candidates.find(item=>contains(entry.location,item.geometry))
    if(feature)callbacks.current.onRegion(feature,entry.location)
  }
  function startArea(event:PointerEvent<HTMLDivElement>) {
    if (event.button!==0) return
    const entry=drawPoint(event)
    if (!entry) return
    if(tool==='circle'){
      if(circleDrag.current)return
      const preview=map.current?.getSource<GeoJSONSource>('circlePreview')
      if(!preview)return
      circleDrag.current={pointerId:event.pointerId,center:entry.location,start:entry.point,preview}
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    lasso.current={points:[entry.location],path:[entry.point]}
    setTrace([entry.point])
  }
  function extendArea(event:PointerEvent<HTMLDivElement>) {
    const entry=drawPoint(event)
    if(!entry)return
    const drag=circleDrag.current
    if(drag?.pointerId===event.pointerId){
      const radius=distance(drag.center,entry.location)
      const area={type:'circle' as const,center:drag.center,radius}
      drag.preview.setData(radius>0?collection([{type:'Feature',geometry:areaPolygon(area),properties:{}}]):empty)
      setCircleLine([drag.center,entry.location])
      onCirclePreviewRadius(radius)
      return
    }
    const line=lasso.current
    if (!line) return
    const previous=line.path[line.path.length-1]
    if (Math.hypot(previous[0]-entry.point[0],previous[1]-entry.point[1])<5) return
    line.points.push(entry.location)
    line.path.push(entry.point)
    setTrace([...line.path])
  }
  function finishArea(event:PointerEvent<HTMLDivElement>) {
    const drag=circleDrag.current
    if(drag){
      if(drag.pointerId!==event.pointerId)return
      const entry=drawPoint(event)
      clearCircle()
      if(entry&&Math.hypot(entry.point[0]-drag.start[0],entry.point[1]-drag.start[1])>=3){
        onArea({type:'circle',center:drag.center,radius:distance(drag.center,entry.location)})
      }
      return
    }
    const line=lasso.current
    lasso.current=null
    setTrace([])
    if (line && line.points.length>=3) onArea({type:'lasso',ring:line.points})
  }

  function cancelArea(event:PointerEvent<HTMLDivElement>) {
    if(circleDrag.current?.pointerId===event.pointerId)clearCircle()
    lasso.current=null
    setTrace([])
  }

  const circleStart=circleLine&&map.current?.project(circleLine[0])
  const circleEnd=circleLine&&map.current?.project(circleLine[1])
  const bearing = Math.round(camera.bearing)%360
  const cardinal = ['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8]
  return <section className="map-stage" aria-label="Wildfire map viewport">
    <div ref={holder} className="map-canvas" onPointerDownCapture={event=>{pointer.current={x:event.clientX,y:event.clientY}}}
      onPointerUpCapture={selectAtPoint}>
      {size.width>0&&<Suspense fallback={<div className="map-loading">Loading Kepler.gl…</div>}>
        <KeplerMap width={size.width} height={size.height} style={style} onMap={bindMap}/>
      </Suspense>}
    </div>
    <div className="map-vignette" aria-hidden="true" />
    <StarField width={size.width} height={Math.min(112,Math.round(size.height*.22))}/>
    {(orbiting||regionFlying)&&<div className="orbital-layer" ref={spaceLayer} aria-hidden="true">
      <Suspense fallback={null}><SpaceCanvas frame={size} transferRef={transferRef} layerRef={spaceLayer}/></Suspense>
    </div>}
    <div className="map-edge top-edge" /><div className="map-edge bottom-edge" />
    {measuring&&ready&&<div className="draw-overlay" onPointerDown={startMeasure} onPointerMove={extendMeasure} onPointerUp={finishMeasure}
      onPointerCancel={()=>{ruler.current=null;setDraft(null)}}>
      <svg width="100%" height="100%" aria-label="Measured distances" className="ruler-svg">
        {[...segments,...(draft?[draft]:[])].map(([a,b],i)=>{
          const p=map.current?.project(a),q=map.current?.project(b)
          if(!p||!q)return null
          const label=distance(a,b)
          return <g key={i}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y}/>
            <circle cx={p.x} cy={p.y} r={7}/><circle cx={q.x} cy={q.y} r={7}/>
            {label>.01&&<text x={(p.x+q.x)/2} y={(p.y+q.y)/2-11}>{label>=1?label.toFixed(2)+' km':Math.round(label*1000)+' m'}</text>}
          </g>
        })}
      </svg>
    </div>}
    {measuring&&<div className="draw-hint"><Ruler size={14}/>Drag between two points</div>}
    {options.ecosystems&&<div className="ecosystem-key"><span/><b>Peatlands</b><span/><b>National parks</b><span/><b>Exclusion zone</b></div>}
    {tool && ready && <div className="draw-overlay" onPointerDown={startArea} onPointerMove={extendArea} onPointerUp={finishArea}
      onPointerCancel={cancelArea} onLostPointerCapture={cancelArea}><svg width="100%" height="100%" aria-hidden="true">
        {circleStart&&circleEnd&&<g className="circle-radius">
          <line x1={circleStart.x} y1={circleStart.y} x2={circleEnd.x} y2={circleEnd.y}/>
          <circle cx={circleStart.x} cy={circleStart.y} r={3}/>
          <circle cx={circleEnd.x} cy={circleEnd.y} r={3}/>
        </g>}
        <polygon points={trace.map(point=>point.join(',')).join(' ')} fill="#55c9e52a" stroke="#65d7f3" strokeDasharray="5 3" />
      </svg></div>}
    {tool && <div className="draw-hint"><Target size={14}/>{tool==='circle'?'Drag from the center to set the radius':'Drag to outline your area'}</div>}
    <div className="map-legend">
      <div className="legend-title"><Layers3 size={13}/> {weekly?'WEEKLY FRP SUM':'FIRE RADIATIVE POWER'} <InfoTip label="Fire radiative power" help={frpHelp+(weekly?' Pillars sum the daily FRP readings within each grid cell.':'')+' Taller pillars indicate higher FRP. The height scale compresses extremes so lower and moderate readings remain distinguishable.'}/></div>
      <div className="thermal-ramp" />
      <div className="legend-scale"><span>0</span><span>50</span><span>100</span><span>150+ MW</span></div>
      <div className="legend-z"><span/><b>Z ≥ 1.5</b><span/><b>Z ≥ 2.5</b></div>
    </div>
    <div className="map-controls">
      <Button className="compass" aria-label="Reset bearing to true north" help="Rotate the map so true north points up." onClick={()=>changeCamera({bearing:0},450)}>
        <span className="compass-face" style={{transform:'rotate('+(-camera.bearing)+'deg)'}}><b>N</b><i/><em/></span>
      </Button>
      <div className="map-control-group">
        <Button help="Switch between an overhead view and a tilted view." aria-label="Toggle 2D / 3D" aria-pressed={camera.pitch>1} onClick={()=>changeCamera({pitch:camera.pitch>1?0:50},550)}><Box size={14}/>{camera.pitch>1?'3D':'2D'}</Button>
        <Button help="Switch between the basemap and satellite imagery." aria-label="Switch Map / Sat" aria-pressed={options.satellite} onClick={()=>onOptions({...options,satellite:!options.satellite})}>{options.satellite?<Satellite size={16}/>:<MapIcon size={16}/>}</Button>
        <Button help="Show or hide the grid used to aggregate nearby fire detections." aria-label="Toggle 3×3 km grid" aria-pressed={options.grid} onClick={()=>onOptions({...options,grid:!options.grid})}><Grid3X3 size={16}/></Button>
      </div>
      <div className="map-control-group">
        <Button help="See a smaller area in greater detail." aria-label="Zoom in" onClick={()=>changeCamera({zoom:Math.min(17,camera.zoom+1)},280)}><Plus size={17}/></Button>
        <Button help="See a larger area." aria-label="Zoom out" onClick={()=>changeCamera({zoom:Math.max(1,camera.zoom-1)},280)}><Minus size={17}/></Button>
      </div>
    </div>
    <div className="camera-bar">
      <span><b>LAT</b> {coord(camera.lat,'lat')}</span><span><b>LON</b> {coord(camera.lon,'lon')}</span>
      <span><b>ZOOM</b> {camera.zoom.toFixed(1)}</span><span><b>BRG</b> {String(bearing).padStart(3,'0')}° {cardinal}</span><span><b>PITCH</b> {Math.round(camera.pitch)}°</span>
    </div>
    <div className="map-credit">{options.ecosystems&&<>GMC · Protected Planet · Harvard MAPA <span>· </span></>}{options.satellite?'NASA EOSDIS GIBS':'NASA Blue Marble · Natural Earth · geoBoundaries'}</div>
  </section>
}
