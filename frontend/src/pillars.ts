import { calibration } from './calibration'
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map } from 'maplibre-gl'
import { offset, type Cell } from './data'

const vertex = `#version 300 es
precision highp float;
uniform mat4 matrix;
in vec3 position;
in vec3 color;
out vec3 tint;
void main() {
  gl_Position = matrix * vec4(position, 1.);
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
type GL = WebGL2RenderingContext

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

  update(cells: Cell[], harmonized: boolean) {
    if (!this.gl || !this.buffer) return
    const vertices: number[] = []
    for (const cell of cells) {
      const height = cell.raw * (harmonized ? calibration.dailyFrp[cell.pass] : 1) * 158
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
