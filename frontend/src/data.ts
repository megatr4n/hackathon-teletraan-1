import { parse } from 'yaml'
import countryCatalog from '../../config/countries.json'
import regionCatalog from '../../config/regions.yaml?raw'
import type { CountryItem, PresetRegion } from './types/api'
import type { Feature, Polygon, MultiPolygon, Position } from 'geojson'

export type Coord = [number, number]
export type Pass = 'all' | 'day' | 'night'
export type Aoi = { type: 'circle'; center: Coord; radius: number } | { type: 'lasso'; ring: Coord[] }
export type Focus = {
  id: string; name: string; short: string; area: string; country: string; date: string;
  center: Coord; zoom: number; raw: number; harmonized: number; median: number;
  count: number; fre: number; rank: number; percentile: number; code: string;
}

const configuredRegions = (parse(regionCatalog) as {regions:PresetRegion[]}).regions

export type MapBounds = PresetRegion['bbox']
export const californiaOverviewBounds=configuredRegions.find(region=>region.id==='us-west')?.bbox

type DemoFocus = Focus & { event:PresetRegion['critical_event'] }

function demoScenario(id:string,presetId:string,name:string,short:string,area:string,country:string,
  telemetry:Pick<Focus,'raw'|'harmonized'|'median'|'count'|'fre'|'rank'|'percentile'|'code'>):DemoFocus {
  const preset=configuredRegions.find(region=>region.id===presetId)
  if(!preset)throw new Error('Missing demo region: '+presetId)
  return {id,name,short,area,country,date:preset.critical_event.date,center:preset.default_center,zoom:preset.default_zoom,event:preset.critical_event,...telemetry}
}

// These telemetry fixtures are used by demo mode. Coordinates and dates come from config/regions.yaml.
export const scenarios: DemoFocus[] = [
  demoScenario('chernobyl','ua-east','Chernobyl Exclusion Zone','Chernobyl (2020)','Ukraine · Eastern Europe','Ukraine',
    {raw:5628,harmonized:4120,median:710,count:158,fre:355.8,rank:1,percentile:99.8,code:'UKR / CEZ'}),
  demoScenario('california','us-west','California Camp Fire','California Camp Fire (2018)','United States · North America','United States',
    {raw:7395,harmonized:5598,median:950,count:214,fre:483.7,rank:2,percentile:99.5,code:'USA / CA'}),
  demoScenario('amazon','amazon','Amazon Basin','Amazon Basin (2019)','Brazil · South America','Brazil',
    {raw:8859,harmonized:6698,median:1698,count:246,fre:578.7,rank:3,percentile:98.7,code:'BRA / AMZ'}),
  demoScenario('australia','australia','Australia Black Summer','Australia Black Summer (2020)','Australia · Oceania','Australia',
    {raw:12524,harmonized:9650,median:1630,count:315,fre:833.8,rank:1,percentile:99.9,code:'AUS / NSW'}),
]
export const chernobylEventBounds = scenarios[0].event.bbox

export const firstDate = '2000-01-01'
export const lastDate = '2025-12-31'
export const DAY = 86_400_000
export const iso = (time: number) => new Date(time).toISOString().slice(0,10)
export const doy = (date: string) => Math.round((Date.parse(date) - Date.parse(date.slice(0,4) + '-01-01')) / DAY) + 1
export const prettyDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' }).format(new Date(date))
export const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
export const coord = (value: number, axis: 'lat'|'lon') => Math.abs(value).toFixed(3) + '° ' + (axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E'))
export const clampDate = (date: string, from: string, to: string) => date < from ? from : date > to ? to : date

export const territories=(countryCatalog as CountryItem[]).slice().sort((a,b)=>a.name_en.localeCompare(b.name_en))
export type Territory = CountryItem
export function countryFocus(c: Territory, date: string): Focus {
  const example = scenarios.find(scenario => scenario.country === c.name_en)
  const seed = [...c.iso3].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const raw = 940 + seed * 13
  return {id:c.iso3,name:c.name_en,short:c.name_en,area:c.name_uk,country:c.name_en,date,center:c.center,zoom:c.zoom,
    raw:example?.raw??raw,harmonized:example?.harmonized??Math.round(raw*.75),median:example?.median??Math.round(raw*.27),
    count:example?.count??Math.round(raw/27),fre:example?.fre??Math.round(raw*.65)/10,
    rank:example?.rank??3+seed%8,percentile:example?.percentile??87+seed%12,code:c.iso3}
}

export function offset([lon,lat]: Coord, east: number, north: number): Coord {
  return [lon + east / (111.32 * Math.cos(lat * Math.PI / 180)), lat + north / 110.57]
}
const earthRadiusKm=6371
export const maxCircleRadius=Math.PI*earthRadiusKm

export function distance(a: Coord,b: Coord) {
  const angle = Math.PI / 180
  const h = Math.sin((b[1] - a[1]) * angle / 2) ** 2 + Math.cos(a[1] * angle) * Math.cos(b[1] * angle) * Math.sin((b[0] - a[0]) * angle / 2) ** 2
  return 2*earthRadiusKm * Math.asin(Math.sqrt(Math.min(1,h)))
}

function circlePoint(center:Coord,radius:number,bearing:number):Coord {
  const radians=Math.PI/180
  const latitude=center[1]*radians
  const angle=radius/earthRadiusKm
  const targetLatitude=Math.asin(Math.sin(latitude)*Math.cos(angle)+Math.cos(latitude)*Math.sin(angle)*Math.cos(bearing))
  const longitudeOffset=Math.atan2(Math.sin(bearing)*Math.sin(angle)*Math.cos(latitude),Math.cos(angle)-Math.sin(latitude)*Math.sin(targetLatitude))
  return [center[0]+longitudeOffset/radians,targetLatitude/radians]
}

export function areaPolygon(aoi: Aoi): Polygon {
  const ring = aoi.type === 'circle'
    ? Array.from({length:96}, (_,i) => circlePoint(aoi.center,aoi.radius,-i*Math.PI/48))
    : aoi.ring
  return {type:'Polygon', coordinates:[[...ring,ring[0]]]}
}
function inside(point: Coord, ring: Position[]) {
  let result = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi,yi] = ring[i], [xj,yj] = ring[j]
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) result = !result
  }
  return result
}
export function contains(point: Coord, geometry: Polygon|MultiPolygon) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some(([outer, ...holes]) => inside(point, outer) && !holes.some(hole => inside(point, hole)))
}
export type Cell = { id:string; center:Coord; weight:number; pass:'day'|'night'; raw:number; geometry?:Polygon|MultiPolygon }
export type MapCell = Omit<Cell,'raw'> & { raw:number|null }
export function cellPolygon(cell: MapCell, halfSide = 1.5): Feature<Polygon|MultiPolygon> {
  const corners = [[-halfSide,-halfSide],[halfSide,-halfSide],[halfSide,halfSide],[-halfSide,halfSide],[-halfSide,-halfSide]]
  return { type:'Feature', geometry:cell.geometry??{type:'Polygon',coordinates:[corners.map(([x,y])=>offset(cell.center,x,y))]}, properties:{id:cell.id,raw_mw:cell.raw,pass:cell.pass} }
}
export const years = Array.from({length:26},(_,i) => 2025-i)
