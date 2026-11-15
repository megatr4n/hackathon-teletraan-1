import { clampDate, firstDate, iso, lastDate, maxCircleRadius, scenarios, type Aoi, type Coord } from './data'
import { countryOptions, focusForRegion, type Region } from './geography'
import { initialSnapshot, type Snapshot } from './pins'

const fields=['country','scenario','region','area','date','from','to','pass','mode','metric','view'] as const

function validDate(value:string|null, fallback:string) {
  if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return fallback
  const time=Date.parse(value)
  return Number.isFinite(time)&&iso(time)===value&&value>=firstDate&&value<=lastDate?value:fallback
}

function parseObject(value:string|null):Record<string,unknown>|null {
  if(!value||value.length>24000)return null
  try{
    const parsed:unknown=JSON.parse(value)
    return parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null
  }catch{return null}
}

function coordinate(value:unknown):value is Coord {
  return Array.isArray(value)&&value.length===2&&value.every(Number.isFinite)&&
    Math.abs(value[0])<=180&&Math.abs(value[1])<=90
}

function localArea(value:string|null):Aoi|null {
  const area=parseObject(value)
  if(area?.type==='circle'&&coordinate(area.center)&&typeof area.radius==='number'&&area.radius>0&&area.radius<=maxCircleRadius)
    return {type:'circle',center:area.center,radius:area.radius}
  if(area?.type==='lasso'&&Array.isArray(area.ring)&&area.ring.length>=3&&area.ring.length<=1000&&area.ring.every(coordinate))
    return {type:'lasso',ring:area.ring}
  return null
}

function catalogRegion(params:URLSearchParams):Region|null {
  const code=params.get('country')
  if(code)return countryOptions().find(country=>country.id===code)??null
  const region=parseObject(params.get('region'))
  const center=[region?.lon,region?.lat]
  if((region?.kind==='admin'||region?.kind==='eco')&&typeof region.id==='string'&&region.id.length<=100&&
    typeof region.name==='string'&&region.name.length<=200&&coordinate(center)&&
    typeof region.zoom==='number'&&region.zoom>=0&&region.zoom<=21){
    const country=typeof region.country==='string'&&/^[A-Z0-9]{3}$/.test(region.country)?region.country:undefined
    if(region.kind==='admin'&&!country)return null
    return {id:region.id,name:region.name,kind:region.kind,lon:center[0],lat:center[1],zoom:region.zoom,country,
      biome:typeof region.biome==='string'?region.biome:undefined}
  }
  return null
}

export function snapshotFromUrl(search=window.location.search):Snapshot {
  const params=new URLSearchParams(search)
  if(params.has('puzzle')||!fields.some(field=>params.has(field)))return initialSnapshot
  const from=validDate(params.get('from'),firstDate)
  const to=validDate(params.get('to'),lastDate)
  if(from>to)return initialSnapshot
  const region=catalogRegion(params)
  const scenario=scenarios.find(entry=>entry.id===params.get('scenario'))??initialSnapshot.focus
  const date=clampDate(validDate(params.get('date'),scenario.date),from,to)
  const aoi=localArea(params.get('area'))
  const focus=region?focusForRegion(region,date):scenario
  const center=aoi?.type==='circle'?aoi.center:aoi?.type==='lasso'?aoi.ring[0]:focus.center
  const normalizedFocus=aoi?{...focus,center}:focus
  const pass=params.get('pass'),metric=params.get('metric')
  return {...initialSnapshot,focus:normalizedFocus,region:aoi?null:region,date,from,to,aoi,
    areaMode:aoi?'custom':region?.kind==='eco'?'ecoregions':'countries',
    radius:aoi?.type==='circle'?aoi.radius:initialSnapshot.radius,query:region?.name??'',
    pass:pass==='day'||pass==='night'?pass:'all',harmonized:params.get('mode')!=='raw',
    metric:metric==='count'||metric==='z'?metric:'frp',calendarView:params.get('view')==='ridge'?'ridge':'grid',
    camera:{...initialSnapshot.camera,lon:center[0],lat:center[1],zoom:focus.zoom}}
}

export function updateViewUrl(settings:Snapshot) {
  const url=new URL(window.location.href)
  if(url.searchParams.has('puzzle'))return
  for(const field of fields)url.searchParams.delete(field)
  const {region,aoi,focus,date,from,to,pass,harmonized,metric,calendarView}=settings
  const params=url.searchParams
  if(aoi)params.set('area',JSON.stringify(aoi))
  else if(region?.kind==='country')params.set('country',region.id)
  else if(region)params.set('region',JSON.stringify(region))
  else if(focus.id!==initialSnapshot.focus.id&&scenarios.some(entry=>entry.id===focus.id))params.set('scenario',focus.id)
  if(region||aoi||date!==focus.date)params.set('date',date)
  if(from!==firstDate)params.set('from',from)
  if(to!==lastDate)params.set('to',to)
  if(pass!=='all')params.set('pass',pass)
  if(!harmonized)params.set('mode','raw')
  // Existing shared views omit the metric for FRP. The bare URL uses the new default.
  if(metric!==initialSnapshot.metric||fields.some(field=>params.has(field)))params.set('metric',metric)
  if(calendarView!=='grid')params.set('view',calendarView)
  if(url.href!==window.location.href)window.history.replaceState(window.history.state,'',url)
}
