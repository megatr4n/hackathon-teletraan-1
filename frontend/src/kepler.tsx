import { useMemo, type ComponentType } from 'react'
import { Provider } from 'react-redux'
import { createStore, combineReducers, applyMiddleware } from 'redux'
import { injectComponents, MapControlFactory } from '@kepler.gl/components'
import { keplerGlReducer, enhanceReduxMiddleware } from '@kepler.gl/reducers'
import { updateMap, wrapTo } from '@kepler.gl/actions'
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { initialSnapshot, type Camera } from './pins'

const ID = 'teletraan'
const seed = initialSnapshot.camera
const reducer = keplerGlReducer.initialState({
  mapState:{latitude:seed.lat,longitude:seed.lon,zoom:seed.zoom,bearing:seed.bearing,pitch:seed.pitch,dragRotate:true,maxPitch:80},
  uiState:{readOnly:true,currentModal:null},
})
const store = createStore(combineReducers({keplerGl:reducer}),applyMiddleware(...enhanceReduxMiddleware()))
const EmptyControls=()=>null
type KeplerProps = {
  id:string; width:number; height:number; readOnly:boolean; appName:string;
  getMapboxRef:(ref:{getMap:()=>MapLibreMap}|null)=>void;
  bottomMapContainerProps:object; mapStyles:object[]; mapStylesReplaceDefault:boolean; initialUiState:object
}
const inject = injectComponents as unknown as (recipes: [typeof MapControlFactory, () => ComponentType][]) => ComponentType<KeplerProps>
const Kepler = inject([[MapControlFactory,()=>EmptyControls]])
const styles = [{id:'teletraan-dark',label:'Teletraan',style:{version:8,sources:{},layers:[]}}]
const initialUiState={readOnly:true,currentModal:null}

export function setKeplerCamera(camera:Partial<Camera>) {
  store.dispatch(wrapTo(ID,updateMap({
    ...(camera.lat===undefined?{}:{latitude:camera.lat}),
    ...(camera.lon===undefined?{}:{longitude:camera.lon}),
    ...(camera.zoom===undefined?{}:{zoom:camera.zoom}),
    ...(camera.bearing===undefined?{}:{bearing:camera.bearing}),
    ...(camera.pitch===undefined?{}:{pitch:camera.pitch}),
  })))
}
export function KeplerMap({width,height,style,onMap}:{width:number;height:number;style:StyleSpecification;onMap:(map:MapLibreMap)=>void}) {
  const props=useMemo(()=>({mapLib:maplibregl,mapStyle:style,maxPitch:80,attributionControl:false,interactive:false,
    canvasContextAttributes:{antialias:true},antialias:true,reuseMaps:false}),[style])
  return <Provider store={store}><Kepler id={ID} width={width} height={height} readOnly appName="TELETRAAN-1"
    mapStyles={styles} initialUiState={initialUiState} mapStylesReplaceDefault bottomMapContainerProps={props}
    getMapboxRef={ref=>{if(ref)onMap(ref.getMap())}}/></Provider>
}
