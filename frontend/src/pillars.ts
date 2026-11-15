import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map } from 'maplibre-gl'
import { offset, type MapCell } from './data'

const vertex = `#version 300 es
precision highp float;
uniform mat4 matrix;
uniform float heightScale;
in vec3 position;
in vec3 color;
out vec3 tint;
void main() {
  gl_Position = matrix * vec4(position.xy, position.z * heightScale, 1.);
  tint = color;
}`
const fragment = `#version 300 es
precision highp float;
in vec3 tint;
out vec4 pixel;
void main() { pixel = vec4(tint, 1.); }`
const faces = [[0,1],[1,2],[2,3],[3,0]]
const shades = [.79, .67, .96, 1]
const colors = [[.48,.037,.038],[1,.24,.028],[1,.68,.135]]
const growthDurationMs = 1250
const growthExponent = 2
const growthEnd = Math.expm1(growthExponent)
type GL = WebGL2RenderingContext

// Keep the existing low-FRP slope and gradually compress taller columns.
const pillarHeightKneeMw = 50
const lowFrpMetersPerMw = 158
export function pillarHeightMeters(frpMw:number) {
  return lowFrpMetersPerMw*pillarHeightKneeMw*Math.asinh(Math.max(0,frpMw)/pillarHeightKneeMw)
}

export class FirePillars implements CustomLayerInterface {
  readonly id = 'fire-pillars'
  readonly type = 'custom'
  readonly renderingMode = '3d'
  private map?: Map
  private program?: WebGLProgram
  private gl?: GL
  private buffer?: WebGLBuffer
  private vao?: WebGLVertexArrayObject
  private length = 0
  private growthStartedAt?: number | null

  onAdd(map: Map, gl: GL) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Pillar shader failed')
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER,vertex), fs = compile(gl.FRAGMENT_SHADER,fragment)
    const program = gl.createProgram()!
    gl.attachShader(program,vs)
    gl.attachShader(program,fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Pillar program failed')
    this.map = map
    this.gl = gl
    this.program = program
    this.buffer = gl.createBuffer()!
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer)
    for (const [i,name] of ['position','color'].entries()) {
      const location = gl.getAttribLocation(program,name)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location,3,gl.FLOAT,false,24,i*12)
    }
    gl.bindVertexArray(null)
  }

  update(cells: MapCell[], animate: boolean) {
    if (!this.gl || !this.buffer) return
    const vertices: number[] = []
    for (const cell of cells) {
      if (cell.raw === null) continue
      const height = pillarHeightMeters(cell.raw)
      const half = .72
      const coordinates = [[-half,-half],[half,-half],[half,half],[-half,half]]
        .map(([x,y]) => MercatorCoordinate.fromLngLat(offset(cell.center,x,y)))
      const scale = coordinates[0].meterInMercatorCoordinateUnits()
      const push = (corner: number, level: number, color: number[], shade: number) => {
        const point = coordinates[corner]
        vertices.push(point.x,point.y,height*level*scale,...color.map(value=>value*shade))
      }
      faces.forEach(([a,b],i) => {
        for (const [lo,hi] of [[0,1],[1,2]]) {
          const levels = [0,.52,1]
          const quad = [[a,lo],[b,lo],[b,hi],[a,lo],[b,hi],[a,hi]]
          quad.forEach(([corner,level])=>push(corner,levels[level],colors[level],shades[i]))
        }
      })
      ;[0,1,2,0,2,3].forEach(corner => push(corner,1,[1,.81,.39],1))
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.buffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(vertices),this.gl.DYNAMIC_DRAW)
    this.length = vertices.length / 6
    this.growthStartedAt = animate && this.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? null
      : undefined
    this.map?.triggerRepaint()
  }

  render(context: GL | WebGLRenderingContext, options: CustomRenderMethodInput) {
    const gl = context as GL
    if (!this.program || !this.vao || !this.length) return
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program,'matrix'),false,options.defaultProjectionData.mainMatrix)
    let heightScale = 1
    if (this.growthStartedAt !== undefined) {
      const now = performance.now()
      this.growthStartedAt ??= now
      const progress = (now - this.growthStartedAt) / growthDurationMs
      if (progress < 1) {
        heightScale = Math.expm1(progress * growthExponent) / growthEnd
        this.map?.triggerRepaint()
      } else {
        this.growthStartedAt = undefined
      }
    }
    gl.uniform1f(gl.getUniformLocation(this.program,'heightScale'),heightScale)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES,0,this.length)
    gl.bindVertexArray(null)
  }

  onRemove(_map: Map, gl: GL) {
    gl.deleteBuffer(this.buffer ?? null)
    gl.deleteVertexArray(this.vao ?? null)
    gl.deleteProgram(this.program ?? null)
  }
}
