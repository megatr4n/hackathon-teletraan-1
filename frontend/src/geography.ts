import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { countryFocus, territories, type Coord, type Focus } from './data'

export type RegionKind = 'country' | 'admin' | 'eco'
export type AreaMode = 'countries' | 'ecoregions' | 'custom'
export type Region = { id:string; name:string; kind:RegionKind; lon:number; lat:number; zoom:number; country?:string; biome?:string }
export type RegionFeature = Feature<Polygon|MultiPolygon,Region>
export type RegionCollection = FeatureCollection<Polygon|MultiPolygon,Region>
export const emptyRegions: RegionCollection = {type:'FeatureCollection',features:[]}
const requests = new Map<string,Promise<unknown>>()

export const asset = (name:string) => new URL(name,document.baseURI).href
export function geography<T>(name:string):Promise<T> {
  if (!requests.has(name)) {
    requests.set(name,fetch(asset('geography/'+name+'.json')).then(response=>{
      if (!response.ok) throw new Error('Unable to load '+name)
      return response.json()
    }).catch(error=>{
      requests.delete(name)
      throw error
    }))
  }
  return requests.get(name) as Promise<T>
}
export function countryOptions() {
  return territories.map(country=>({
    id:country.iso3,name:country.name_en,kind:'country' as const,country:country.iso3,
    lon:country.center[0],lat:country.center[1],zoom:country.zoom,
  }))
}
export function focusForRegion(region:Region,date:string,center?:Coord):Focus {
  const country = territories.find(c=>c.iso3===region.country)
  const national = country ?? territories.find(c=>c.iso3==='UKR')!
  const baseline = countryFocus(national,date)
  const seed=[...region.id].reduce((value,char)=>value+char.charCodeAt(0),0)
  const raw=1500+(seed*37)%3800
  const harmonized=country&&region.kind==='country'?baseline.harmonized:Math.round(raw*.748)
  return {
    ...(country&&region.kind==='country'?baseline:{...baseline,raw,harmonized,median:Math.round(harmonized*.3),count:Math.floor(raw/26),fre:harmonized*.0864,rank:3+seed%8,percentile:88+seed%11}),
    id:region.kind+':'+region.id,name:region.name,short:region.name,
    area:region.kind==='admin'?(country?.name_en??'')+' · Administrative region':region.kind==='eco'?(region.biome||'Terrestrial ecoregion'):'Country or territory',
    country:country?.name_en??'',date,center:center??[region.lon,region.lat],zoom:region.zoom,code:region.id,
  }
}
