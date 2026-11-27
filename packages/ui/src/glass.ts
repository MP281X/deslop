import {Mount} from '@effect/ui'
import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Effect, Function, Number, Option, Stream, String, pipe} from 'effect'

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform float scale;
uniform float corner;
out vec4 color;
void main() {
  vec2 p = (gl_FragCoord.xy - resolution * .5) / scale;
  vec2 halfSize = resolution * .5 / scale;
  float radius = min(min(halfSize.x, halfSize.y), corner);
  vec2 q = p - clamp(p, -halfSize + radius, halfSize - radius);
  float r = length(q);
  float depth = radius - r;
  float coverage = smoothstep(-.25, .75, depth);
  vec2 normal = q / max(r, 1.);
  float lower = clamp((.38 - p.y / halfSize.y) * 1.8, 0., 1.);
  float fill = mix(.105, .166, lower * lower * lower);
  float rim = 1. - smoothstep(1., 2.15, depth);
  float edge = max(normal.y, 0.) * .14 + max(-normal.y, 0.) * .204;
  float opacity = coverage * (fill + rim * edge);
  color = vec4(vec3(opacity), opacity);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
	const shader = gl.createShader(type)
	if (shader === null) return
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	return shader
}

function drawLens(canvas: HTMLCanvasElement) {
	const gl = canvas.getContext('webgl2', {alpha: true, antialias: false})
	if (gl === null) return
	const vs = compile(gl, gl.VERTEX_SHADER, VERTEX)
	const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
	const program = gl.createProgram()
	if (vs === undefined || fs === undefined) return
	gl.attachShader(program, vs)
	gl.attachShader(program, fs)
	gl.linkProgram(program)
	gl.deleteShader(vs)
	gl.deleteShader(fs)
	gl.useProgram(program)
	const resolution = gl.getUniformLocation(program, 'resolution')
	const scale = gl.getUniformLocation(program, 'scale')
	const corner = gl.getUniformLocation(program, 'corner')
	const surface = canvas
	const observer = new ResizeObserver(() => {
		if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return
		const density: number = window.devicePixelRatio
		surface.width = Math.ceil(canvas.clientWidth * density)
		surface.height = Math.ceil(canvas.clientHeight * density)
		gl.viewport(0, 0, canvas.width, canvas.height)
		gl.uniform2f(resolution, canvas.width, canvas.height)
		gl.uniform1f(scale, density)
		gl.uniform1f(
			corner,
			pipe(
				getComputedStyle(canvas).borderTopLeftRadius,
				String.replace('px', ''),
				Number.parse,
				Option.getOrElse(Function.constant(0))
			)
		)
		gl.drawArrays(gl.TRIANGLES, 0, 3)
	})
	observer.observe(canvas)
	return () => {
		observer.disconnect()
		gl.deleteProgram(program)
	}
}

const Lens = Mount.makeStream('Lens', {args: {}}, (canvas: HTMLCanvasElement) =>
	Stream.unwrap(
		Effect.as(
			Effect.acquireRelease(
				Effect.sync(() => drawLens(canvas)),
				dispose => Effect.sync(() => dispose?.())
			),
			Stream.never
		)
	)
)

export function Glass<M>(h: Html.H<M>, className?: string) {
	return h.div
		.class('glass', className)
		.children(h.canvas.class('glass-lens').attr('aria-hidden', 'true').onMount(Lens({})))
}

// Set the invoker's popovertarget to id so the browser owns both dismissal and the anchor.
export function GlassPanel<M>(h: Html.H<M>, id: string, label: string, children: View.Input<M>) {
	return Glass(h, 'glass-panel')
		.id(id)
		.attrs({'aria-label': label, popover: 'auto', role: 'group'})
		.children(h.div.class('glass-panel-body').children(children))
}
