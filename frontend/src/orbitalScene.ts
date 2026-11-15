import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, LinearFilter, Mesh,
  MeshBasicMaterial, MeshPhongMaterial, PerspectiveCamera, Points, PointsMaterial, Scene, SphereGeometry,
  SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three'
import { asset } from './geography'
import { transferClimb, transferDescent } from './cameraTour'
import type { Camera } from './pins'

export type SpaceTransfer = {
  moon:boolean
  progress:number
  camera:Camera
  viewportHeight:number
}

const radians=Math.PI/180
const sphere=(longitude:number,latitude:number,radius=1)=>new Vector3(
  Math.cos(latitude*radians)*Math.cos(longitude*radians)*radius,
  Math.sin(latitude*radians)*radius,
  -Math.cos(latitude*radians)*Math.sin(longitude*radians)*radius,
)

export class OrbitalScene {
  private renderer:WebGLRenderer
  private scene=new Scene()
  private camera=new PerspectiveCamera(39,1,.01,110)
  private loader=new TextureLoader()
  private moon:Mesh<SphereGeometry,MeshBasicMaterial>
  private stars:Points<BufferGeometry,PointsMaterial>
  private textures:ReturnType<TextureLoader['load']>[]=[]
  private right=new Vector3()
  private up=new Vector3()
  private target=new Vector3()

  constructor(canvas:HTMLCanvasElement) {
    this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:false})
    this.renderer.setClearColor(0x040711)

    const texture=(name:string)=>{
      const result=this.loader.load(asset('space/'+name+'.webp'),undefined,undefined,()=>{})
      result.colorSpace=SRGBColorSpace
      result.minFilter=LinearFilter
      this.textures.push(result)
      return result
    }

    let seed=2971
    const random=()=>{
      seed=(Math.imul(1664525,seed)+1013904223)>>>0
      return seed/2**32
    }
    const points:number[]=[], colors:number[]=[]
    for(let index=0;index<4100;index++){
      const point=sphere(random()*360,Math.asin(random()*2-1)/radians,64)
      points.push(point.x,point.y,point.z)
      const light=.23+random()**2*.72
      colors.push(light*.82,light*.90,light)
    }
    const starGeometry=new BufferGeometry()
      .setAttribute('position',new Float32BufferAttribute(points,3))
      .setAttribute('color',new Float32BufferAttribute(colors,3))
    this.stars=new Points(starGeometry,new PointsMaterial({vertexColors:true,size:1.1,sizeAttenuation:false}))
    this.scene.add(this.stars)

    const earth=new Mesh(new SphereGeometry(1,64,48),new MeshPhongMaterial({
      map:texture('earth'),color:0xd8ecff,shininess:19,specular:0x25466c,emissive:0x07152e,
    }))
    this.scene.add(earth)
    this.scene.add(new AmbientLight(0xb7d0ff,.78))
    const key=new DirectionalLight(0xffe3b3,2.45)
    key.position.set(-4,6,5)
    this.scene.add(key)
    const edge=new DirectionalLight(0x4388ff,.83)
    edge.position.set(3,-1,-4)
    this.scene.add(edge)

    this.moon=new Mesh(new SphereGeometry(1,64,48),new MeshBasicMaterial({
      map:texture('moon'),color:new Color().setScalar(.95),
    }))
    this.scene.add(this.moon)
  }

  resize(width:number,height:number) {
    if(!width||!height)return
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.35))
    this.renderer.setSize(width,height,false)
    this.camera.aspect=width/height
    this.camera.updateProjectionMatrix()
  }

  render(transfer:SpaceTransfer) {
    const {progress,camera}=transfer
    const outward=sphere(camera.lon,camera.lat)
    const portrait=this.camera.aspect<1
    const descent=transferDescent(progress)
    const climb=transferClimb(progress)
    // Match MapLibre's visible scale by the end of the crossfade, using its
    // Mercator zoom and 37° vertical field of view at the destination latitude.
    const globeFov=(portrait?54:42)+descent*(36.87-(portrait?54:42))
    const mapScale=transfer.viewportHeight*2*Math.PI*Math.cos(camera.lat*radians)/(2*512*2**camera.zoom*Math.tan(globeFov*radians/2))
    const distance=1+(.035+2.71*climb)*(1-descent)+Math.max(.012,mapScale)*descent
    this.camera.position.copy(outward).multiplyScalar(distance)
    this.right.set(0,1,0).cross(outward).normalize()
    this.up.crossVectors(outward,this.right).normalize()
    this.camera.fov=globeFov
    this.camera.updateProjectionMatrix()
    this.target.copy(outward).multiplyScalar(descent*.92)
      .addScaledVector(this.up,(portrait?.20:.15)*(1-descent))
    const mapBearing=((camera.bearing+180)%360)-180

    this.camera.lookAt(this.target)
    this.camera.rotateZ(.06*Math.sin(progress*Math.PI)*(1-descent)+mapBearing*radians*descent*.8)
    this.stars.position.copy(this.camera.position)

    this.moon.visible=transfer.moon
    if(this.moon.visible){
      const depth=12
      const radius=depth*Math.sin(Math.atan(.075*Math.tan(globeFov*radians/2)))
      const limb=depth/Math.sqrt(distance**2-1)
      const angle=portrait?1.29:.88
      const offset=limb+radius*.4
      this.moon.scale.setScalar(radius)
      this.moon.position.copy(this.camera.position).addScaledVector(outward,-depth)
        .addScaledVector(this.right,Math.cos(angle)*offset).addScaledVector(this.up,Math.sin(angle)*offset)
      this.moon.rotation.y=.3+progress*.3
    }
    this.renderer.render(this.scene,this.camera)
  }

  dispose() {
    this.scene.traverse(object=>{
      if(!(object instanceof Mesh||object instanceof Points))return
      object.geometry.dispose()
      const materials=Array.isArray(object.material)?object.material:[object.material]
      for(const material of materials)material.dispose()
    })
    this.textures.forEach(texture=>texture.dispose())
    this.renderer.dispose()
  }
}

