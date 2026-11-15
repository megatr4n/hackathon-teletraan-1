import {
  AdditiveBlending, AmbientLight, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, Mesh,
  MeshBasicMaterial, MeshPhongMaterial, PerspectiveCamera, Points, PointsMaterial, Scene, SphereGeometry,
  ShaderMaterial, SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three'
import { asset } from './geography'
import { spaceTransferOpacity } from './cameraTour'
import type { Camera } from './pins'

export type SpaceTransfer = {
  moon:boolean
  progress:number
  camera:Camera
  viewportHeight:number
}

const radians=Math.PI/180
const mapFieldOfView=2*Math.atan(1/3)
const sphere=(longitude:number,latitude:number,radius=1)=>new Vector3(
  Math.cos(latitude*radians)*Math.cos(longitude*radians)*radius,
  Math.sin(latitude*radians)*radius,
  -Math.cos(latitude*radians)*Math.sin(longitude*radians)*radius,
)

export class OrbitalScene {
  private renderer:WebGLRenderer
  private scene=new Scene()
  private camera=new PerspectiveCamera(mapFieldOfView/radians,1,.0001,110)
  private loader=new TextureLoader()
  private moon:Mesh<SphereGeometry,MeshBasicMaterial>
  private stars:Points<BufferGeometry,PointsMaterial>
  private textures:ReturnType<TextureLoader['load']>[]=[]
  private right=new Vector3()
  private up=new Vector3()
  private target=new Vector3()
  private heading=new Vector3()
  private forward=new Vector3()
  private clouds:Mesh<SphereGeometry,MeshPhongMaterial>
  private atmosphere:Mesh<SphereGeometry,ShaderMaterial>
  private earthLoaded=false
  private cloudsLoaded=false

  get ready() { return this.earthLoaded }

  constructor(canvas:HTMLCanvasElement) {
    this.renderer=new WebGLRenderer({canvas,antialias:true,alpha:false})
    this.renderer.setClearColor(0x040711)

    const texture=(name:string,isColor=true)=>{
      const result=this.loader.load(asset('space/'+name+'.webp'),()=>{
        if(name==='earth')this.earthLoaded=true
        if(name==='clouds')this.cloudsLoaded=true
      },undefined,()=>{})
      if(isColor)result.colorSpace=SRGBColorSpace
      result.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy())
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

    const earth=new Mesh(new SphereGeometry(1,128,96),new MeshPhongMaterial({
      map:texture('earth'),color:0xeaf1ff,shininess:29,specular:0x1d4257,emissive:0x060c16,
    }))
    this.scene.add(earth)
    this.scene.add(new AmbientLight(0xc7dcff,.69))
    const key=new DirectionalLight(0xfff2cf,2.12)
    key.position.set(-4,6,5)
    this.scene.add(key)
    this.clouds=new Mesh(new SphereGeometry(1.003,96,64),new MeshPhongMaterial({
      alphaMap:texture('clouds',false),color:0xf5f8ff,emissive:0x121d32,specular:0x000000,
      opacity:0,transparent:true,depthWrite:false,
    }))
    this.clouds.renderOrder=1
    this.scene.add(this.clouds)
    this.atmosphere=new Mesh(new SphereGeometry(1.008,96,64),new ShaderMaterial({
      transparent:true,depthWrite:false,blending:AdditiveBlending,
      uniforms:{strength:{value:0},sunDirection:{value:key.position.clone().normalize()}},
      vertexShader:`
        varying vec3 worldNormal;
        varying vec3 worldPosition;
        void main() {
          worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          worldNormal = normalize(worldPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader:`
        uniform float strength;
        uniform vec3 sunDirection;
        varying vec3 worldNormal;
        varying vec3 worldPosition;
        void main() {
          vec3 view = normalize(cameraPosition - worldPosition);
          vec3 normal = normalize(worldNormal);
          float rim = pow(1.0 - max(0.0, dot(normal, view)), 4.6);
          float daylight = smoothstep(-0.35, 0.7, dot(normal, sunDirection));
          vec3 glow = mix(vec3(0.075, 0.24, 0.68), vec3(0.45, 0.76, 1.0), daylight);
          gl_FragColor = vec4(glow, rim * strength * mix(0.33, 1.0, daylight));
        }`,
    }))
    this.atmosphere.renderOrder=2
    this.scene.add(this.atmosphere)

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
    this.right.set(0,1,0).cross(outward).normalize()
    this.up.crossVectors(outward,this.right).normalize()
    const bearing=camera.bearing*radians
    const pitch=camera.pitch*radians
    this.heading.copy(this.up).multiplyScalar(Math.cos(bearing)).addScaledVector(this.right,Math.sin(bearing))
    // Use the map's vertical field of view and local Mercator scale at both handoffs.
    const mapDistance=transfer.viewportHeight*Math.PI*Math.cos(camera.lat*radians)/(512*2**camera.zoom*Math.tan(mapFieldOfView/2))
    const orbitalBlend=spaceTransferOpacity(progress)**2
    const orbitDistance=2.55/Math.min(1,this.camera.aspect)
    const eyeDistance=mapDistance+(Math.max(mapDistance,orbitDistance)-mapDistance)*orbitalBlend
    this.target.copy(outward)
    this.camera.position.copy(outward).multiplyScalar(1+eyeDistance*Math.cos(pitch))
      .addScaledVector(this.heading,-eyeDistance*Math.sin(pitch))
    this.camera.up.copy(this.heading)
    this.camera.lookAt(this.target)
    this.stars.position.copy(this.camera.position)

    const cloudOpacity=.69*orbitalBlend
    this.clouds.visible=this.cloudsLoaded&&eyeDistance>.05&&cloudOpacity>.01
    this.clouds.material.opacity=cloudOpacity
    this.atmosphere.visible=eyeDistance>.075
    this.atmosphere.material.uniforms.strength.value=.66*orbitalBlend
    this.moon.visible=transfer.moon&&orbitalBlend>.6
    if(this.moon.visible){
      const depth=12
      const radius=depth*.025
      const limb=depth/Math.sqrt(this.camera.position.lengthSq()-1)
      const angle=this.camera.aspect<1?1.39:.88
      const offset=limb+radius*.4
      this.camera.getWorldDirection(this.forward)
      this.moon.scale.setScalar(radius)
      this.moon.position.copy(this.camera.position).addScaledVector(this.forward,depth)
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

