import {Array, MutableHashMap, MutableList, Number, Option, Order, Record, String, Tuple, pipe} from 'effect'

import * as THREE from 'three'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

import type {Built} from './-mesh.ts'

import type {Frame} from '#services/game/schema.ts'
import {CHUNK, LEVEL, ORES, chunkOf, highest, lowest} from '#services/world/lib/utils.ts'

// Half the view's height in tiles: nearest, farthest and at the start.
const ZOOM = {farthest: 40, nearest: 3.5, start: 12}
const NOISE = `
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
vec3 vor(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.; vec2 id = vec2(0); for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 g = vec2(float(x), float(y)); vec2 o = vec2(h21(i + g), h21(i + g + 17.3)) * .8 + .1; float d = length(g + o - f); if (d < d1){ d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d; } return vec3(d2 - d1, h21(id), d1); }`
// The fog's sight discs at most, and its window's side in tiles.
const SIGHTS = 48
const FOG_SIZE = 512
// How long the camera takes to move to a new unit or frame, and how far it cuts instead.
const GLIDE = {cut: 40, seconds: 0.45}
const NDC_CORNERS = [
	{x: -1, y: -1},
	{x: 1, y: -1},
	{x: -1, y: 1},
	{x: 1, y: 1}
]
// The chunks a tile change can show in: its own, and any whose ore stain or wall colours reach four tiles over.
const REACH = [
	{x: 0, z: 0},
	{x: -4, z: 0},
	{x: 4, z: 0},
	{x: 0, z: -4},
	{x: 0, z: 4}
]
// The fog: a window of the explored map a texel a tile, and the discs Home and the units see. Both edges wobble with noise, so neither reads as a tile grid or a clean circle. Unexplored ground keeps a trace of its shape; explored ground out of sight is dimmed and greyed.
const FOG = `
uniform sampler2D uFog; uniform vec3 uFogWindow; uniform vec4 uSights[${SIGHTS}]; uniform int uSightCount; uniform vec3 uFogUnknown, uFogSeen;
vec3 fogged(vec3 c, vec3 w){
	vec2 wob = vec2(vn(w.xz * .23), vn(w.xz * .23 + 19.7)) - .5;
	vec2 uv = (w.xz + wob * 3.2 - uFogWindow.xy) / uFogWindow.z;
	float t = 1.6 / uFogWindow.z;
	float e = (texture2D(uFog, uv).r * 2. + texture2D(uFog, uv + vec2(t, 0)).r + texture2D(uFog, uv - vec2(t, 0)).r + texture2D(uFog, uv + vec2(0, t)).r + texture2D(uFog, uv - vec2(0, t)).r) / 6.;
	float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
	float n = (vn(w.xz * .31) - .5) * 3.4 + (vn(w.xz * 1.1 + 7.1) - .5) * .9;
	float seen = 0.;
	for (int i = 0; i < ${SIGHTS}; i++){ if (i >= uSightCount) break; vec4 s = uSights[i]; seen = max(seen, 1. - smoothstep(s.z - 3., s.z, length(w.xz - s.xy) + n)); }
	// What a unit sees now counts as explored before the server's next reveal arrives.
	float known = max(smoothstep(.25, .75, e) * inside, seen);
	float grey = dot(c, vec3(.299, .587, .114));
	vec3 dim = mix(mix(c, vec3(grey), .6) * .8, uFogSeen, .3);
	return mix(mix(uFogUnknown, c, .1), mix(dim, c, seen * known), known);
}`
const FOG_UNKNOWN = new THREE.Color('#b9b1a5')

// The camera looks down 30° and turns only in the quarter turns the player asks for.
const ELEVATION = (30 * Math.PI) / 180
const SUN = new THREE.Vector3(-0.35, 0.8, 0.45).normalize()
const UP = new THREE.Vector3(0, 1, 0)

type Loaded = {built: Option.Option<Built>; group: THREE.Group; revision: number; wanted: number}
type Clock = {value: number}
type Uniforms = Record<string, THREE.IUniform>
// Where the camera goes: a key per subject, so a new subject glides there and the same one stays locked on; a zoom when the subject sets one.
export type Aim = {key: string; x: number; y: number; z: number; zoom: Option.Option<number>}

function waterMaterial(time: Clock, fog: Uniforms, colours: {deep: string; foam: string; shallow: string}) {
	return new THREE.ShaderMaterial({
		fragmentShader: `uniform float uT; uniform vec3 uA, uB, uF; varying float vS; varying vec3 vW; ${NOISE} ${FOG}
			void main(){
				if (vS < -.5) { gl_FragColor = vec4(fogged(uB * .82, vW), 1.); return; }
				float s = vS, wob = .045 * sin(vW.x * 3.1 + uT * 1.3) + .03 * sin(vW.z * 4.3 - uT * 1.1);
				vec3 c = mix(uA, uB, smoothstep(0., 1.1, s + wob * .6));
				float lip = 1. - smoothstep(.03, .1, s);
				float band = 1. - smoothstep(0., .05, abs(s - .16 - .05 * sin(uT * 1.1) - wob * .4));
				float sp = smoothstep(.93, .97, vn(vec2(vW.x * 5. + uT * .4, vW.z * 5. - uT * .3))) * smoothstep(.2, .6, s);
				c = mix(c, uF, max(lip, band * .55)) + sp * .35;
				gl_FragColor = vec4(fogged(c, vW), 1.);
				#include <colorspace_fragment>
			}`,
		side: THREE.DoubleSide,
		uniforms: {
			...fog,
			uA: {value: new THREE.Color(colours.shallow)},
			uB: {value: new THREE.Color(colours.deep)},
			uF: {value: new THREE.Color(colours.foam)},
			uT: time
		},
		vertexShader: `attribute float aS; varying float vS; varying vec3 vW; void main(){ vS = aS; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
	})
}

// Falls: aF is (along the edge, distance below the lip, total height); mode 0 water, 1 lava, 2 ice.
function fallMaterial(time: Clock, fog: Uniforms, mode: number, colours: {a: string; b: string; foam: string}) {
	return new THREE.ShaderMaterial({
		fragmentShader: `uniform float uT; uniform vec3 uA, uB, uF; uniform int uMode; varying vec3 vF; varying vec3 vW; ${NOISE} ${FOG}
			void main(){
				float u = vF.x, v = vF.y, H = vF.z; vec3 c;
				if (uMode == 0) {
					float n = vn(vec2(u * 6., v * 1.4 - uT * 2.2)), n2 = vn(vec2(u * 17. + 3., v * 3.2 - uT * 3.8));
					c = mix(uB, uA, smoothstep(.25, .75, n)); c = mix(c, uF, smoothstep(.55, .85, n2) * .85);
					c = mix(c, uF, 1. - smoothstep(0., .1, v)); c = mix(c, uF, smoothstep(H - .32, H, v) * .9);
				} else if (uMode == 1) {
					vec3 r = vor(vec2(u * 2.4, v * 1.1 - uT * 1.1)); float crack = 1. - smoothstep(.05, .2, r.x);
					c = mix(uF * (1. + .2 * r.y), uA, crack); c = mix(c, uB, crack * smoothstep(.4, .9, vn(vec2(u * 3., v * 2. - uT * 1.6)))) + uA * .3;
					c = mix(c, uB, 1. - smoothstep(0., .08, v));
				} else {
					float n = vn(vec2(u * 9., v * .7)), n2 = vn(vec2(u * 26., v * .25));
					c = mix(uB, uA, n); c = mix(c, uF, smoothstep(.6, .9, n2) * .7); c = mix(c, uF, 1. - smoothstep(0., .07, v));
				}
				gl_FragColor = vec4(fogged(c, vW), 1.);
				#include <colorspace_fragment>
			}`,
		side: THREE.DoubleSide,
		uniforms: {
			...fog,
			uA: {value: new THREE.Color(colours.a)},
			uB: {value: new THREE.Color(colours.b)},
			uF: {value: new THREE.Color(colours.foam)},
			uMode: {value: mode},
			uT: time
		},
		vertexShader: `attribute vec3 aF; varying vec3 vF; varying vec3 vW; void main(){ vF = aF; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
	})
}

// Each liquid kind's surface and falls, all on one clock: water, lava, ice, sulfur, brine, hot springs and lagoons.
function liquidMaterials(time: Clock, fog: Uniforms) {
	return [
		{
			fall: fallMaterial(time, fog, 0, {a: '#c4ece8', b: '#82cfd1', foam: '#ffffff'}),
			kind: 1,
			surface: waterMaterial(time, fog, {deep: '#6fc3c8', foam: '#ffffff', shallow: '#a8e0dc'})
		},
		{
			fall: fallMaterial(time, fog, 1, {a: '#ff8a5b', b: '#ffd59a', foam: '#9a6a5c'}),
			kind: 2,
			surface: new THREE.ShaderMaterial({
				fragmentShader: `uniform float uT; uniform vec3 uA, uB, uC; varying vec3 vW; ${NOISE} ${FOG}
					void main(){
						vec2 p = vec2(vW.x * 2.6 + vW.y, vW.z * 1.6 - uT * .35);
						vec3 v = vor(p + vec2(vn(p * .7 + uT * .1) * .6, 0.));
						float hot = vn(vec2(vW.x * 3., vW.z * 2. - uT * .8)) * .6 + .4 * sin(uT * 2. + vW.z * 3.);
						float crack = 1. - smoothstep(.06, .22, v.x);
						vec3 c = mix(uC * (1. + .2 * v.y), uA, crack); c = mix(c, uB, crack * smoothstep(.3, .9, hot)) + uA * .25;
						gl_FragColor = vec4(fogged(c, vW), 1.);
						#include <colorspace_fragment>
					}`,
				side: THREE.DoubleSide,
				uniforms: {
					...fog,
					uA: {value: new THREE.Color('#ff8a5b')},
					uB: {value: new THREE.Color('#ffd59a')},
					uC: {value: new THREE.Color('#9a6a5c')},
					uT: time
				},
				vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
			})
		},
		{
			fall: fallMaterial(time, fog, 2, {a: '#eaf8fb', b: '#93cbe0', foam: '#ffffff'}),
			kind: 3,
			surface: waterMaterial(time, fog, {deep: '#a6d8e8', foam: '#ffffff', shallow: '#e4f5f9'})
		},
		{
			fall: fallMaterial(time, fog, 0, {a: '#f8e98f', b: '#ecd055', foam: '#fff9d6'}),
			kind: 4,
			surface: waterMaterial(time, fog, {deep: '#ecd055', foam: '#fff9d6', shallow: '#f8e98f'})
		},
		{
			fall: fallMaterial(time, fog, 0, {a: '#c8f3ec', b: '#7ed6cf', foam: '#ffffff'}),
			kind: 5,
			surface: waterMaterial(time, fog, {deep: '#7ed6cf', foam: '#ffffff', shallow: '#c8f3ec'})
		},
		{
			fall: fallMaterial(time, fog, 0, {a: '#bff3f0', b: '#5fd0d6', foam: '#fbf3e4'}),
			kind: 6,
			surface: waterMaterial(time, fog, {deep: '#45c3d3', foam: '#fbf3e4', shallow: '#a6ece6'})
		},
		{
			fall: fallMaterial(time, fog, 0, {a: '#b9f1e6', b: '#6fd8cf', foam: '#ffffff'}),
			kind: 7,
			surface: waterMaterial(time, fog, {deep: '#5cc9cf', foam: '#ffffff', shallow: '#b5efe2'})
		}
	]
}

/* oxlint-disable no-param-reassign -- three takes onBeforeCompile off the material and hands it the shader to edit in place. */
// Fogs a lit three material: its world position carried to the fragment, the fog applied to its final colour.
function fogMaterial<M extends THREE.Material>(material: M, fog: Uniforms) {
	material.onBeforeCompile = shader => {
		for (const entry of Record.toEntries(fog)) shader.uniforms[entry[0]] = entry[1]
		shader.vertexShader = pipe(
			shader.vertexShader,
			String.replace('#include <common>', '#include <common>\nvarying vec3 vFogW;'),
			String.replace(
				'#include <project_vertex>',
				'#include <project_vertex>\nvec4 fogAt = vec4(transformed, 1.);\n#ifdef USE_INSTANCING\nfogAt = instanceMatrix * fogAt;\n#endif\nvFogW = (modelMatrix * fogAt).xyz;'
			)
		)
		shader.fragmentShader = pipe(
			shader.fragmentShader,
			String.replace('#include <common>', `#include <common>\nvarying vec3 vFogW;${NOISE}${FOG}`),
			String.replace(
				'#include <opaque_fragment>',
				'#include <opaque_fragment>\ngl_FragColor.rgb = fogged(gl_FragColor.rgb, vFogW);'
			)
		)
	}
	return material
}
/* oxlint-enable no-param-reassign */

function outcropGeometry(shape: string) {
	if (shape === 'chunk') return new THREE.DodecahedronGeometry(1, 0).scale(1, 0.75, 1)
	if (shape === 'boulder') return new THREE.DodecahedronGeometry(1, 0).scale(1, 0.7, 0.9)
	if (shape === 'oct') return new THREE.OctahedronGeometry(1, 0).scale(0.55, 1.2, 0.55).translate(0, 0.6, 0)
	if (shape === 'prism') return new THREE.CylinderGeometry(0.42, 0.5, 1, 6).translate(0, 0.5, 0)
	if (shape === 'blob') return new THREE.SphereGeometry(1, 9, 6).scale(1, 0.55, 0.9)
	if (shape === 'slab') return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
	if (shape === 'dune') return new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 0.7)
	if (shape === 'cube') return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.35, 0)
	if (shape === 'orb') return new THREE.SphereGeometry(1, 8, 6)
	return new THREE.BoxGeometry(1, 1, 1)
}

function standard(colour: string, glow: boolean) {
	if (glow) {
		return new THREE.MeshStandardMaterial({color: colour, emissive: colour, emissiveIntensity: 0.8, roughness: 0.6})
	}
	return new THREE.MeshStandardMaterial({color: colour, metalness: 0, roughness: 0.78})
}

// Each instanced decoration the mesher places: its shape, its fogged material and whether it casts a shadow.
function decorations(fog: Uniforms) {
	const fixed = [
		{
			cast: false,
			geometry: new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2),
			key: 'pit',
			material: standard('#5f5046', false)
		},
		{cast: true, geometry: new THREE.SphereGeometry(1, 8, 5), key: 'spoil', material: standard('#9c8a78', false)},
		{
			cast: true,
			geometry: mergeGeometries([
				new THREE.ConeGeometry(0.018, 0.12, 4).translate(0, 0.06, 0).rotateZ(0.25),
				new THREE.ConeGeometry(0.016, 0.1, 4).translate(0, 0.05, 0).rotateZ(-0.3).translate(0.03, 0, 0.01),
				new THREE.ConeGeometry(0.014, 0.08, 4).translate(0, 0.04, 0).rotateX(0.3).translate(-0.01, 0, 0.03)
			]),
			key: 'tuft',
			material: standard('#93c27d', false)
		},
		{
			cast: true,
			geometry: mergeGeometries(
				Array.map(Array.range(0, 4), k =>
					new THREE.CylinderGeometry(0.006, 0.01, 0.42 + (k % 3) * 0.1, 4)
						.translate(0, 0.22, 0)
						.rotateZ((k - 2) * 0.12)
						.translate((k - 2) * 0.025, 0, (k % 2) * 0.03)
				)
			),
			key: 'reed',
			material: standard('#a9bf83', false)
		},
		{
			cast: false,
			geometry: new THREE.CylinderGeometry(0.3, 0.32, 0.03, 6),
			key: 'plate',
			material: standard('#fbf9f4', false)
		},
		{
			cast: true,
			geometry: new THREE.CylinderGeometry(0.16, 0.16, 1, 6).translate(0, 0.5, 0),
			key: 'basalt',
			material: new THREE.MeshStandardMaterial({
				color: new THREE.Color('#7a716c').multiply(new THREE.Color('#5a514d')),
				roughness: 0.78
			})
		},
		{
			cast: false,
			geometry: new THREE.ConeGeometry(0.035, 0.26, 5).rotateX(Math.PI).translate(0, -0.13, 0),
			key: 'icicle',
			material: standard('#e3f4f8', false)
		}
	]
	const ores = Array.map(Record.toEntries(ORES), entry => ({
		cast: true,
		geometry: outcropGeometry(entry[1].shape),
		key: `ore:${entry[0]}`,
		material: standard(entry[1].colour, entry[1].glow)
	}))
	return MutableHashMap.fromIterable(
		Array.map([...fixed, ...ores], decoration =>
			Tuple.make(decoration.key, {...decoration, material: fogMaterial(decoration.material, fog)})
		)
	)
}

function meshOf(
	data: {colors: Float32Array; normals: Float32Array; positions: Float32Array},
	material: THREE.Material
) {
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
	geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
	geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
	geometry.computeBoundingSphere()
	const mesh = new THREE.Mesh(geometry, material)
	mesh.castShadow = true
	mesh.receiveShadow = true
	return mesh
}

// Where a unit stands on a tile: a bridge's deck where one crosses, else the ground.
function footing(bed: number, deck: number) {
	if (deck < Infinity) return deck
	return bed
}

// A chunk's own geometry goes with it; decorations share their geometry across chunks, so only their instance buffers do.
function disposeGroup(group: THREE.Group) {
	group.traverse(object => {
		if (object instanceof THREE.InstancedMesh) object.dispose()
		else if (object instanceof THREE.Mesh) object.geometry.dispose()
	})
	group.removeFromParent()
}

function chunkKey(cx: number, cz: number) {
	return (cx + 4096) * 8192 + (cz + 4096)
}

// Ambient occlusion, kept off liquids and glow so water does not darken at its shore.
class Occlusion extends GTAOPass {
	hidden = Array.empty<THREE.Object3D>()

	// three calls these by their runtime names round its normal pass.
	_overrideVisibility() {
		const found = MutableList.make<THREE.Object3D>()
		this.scene.traverse(object => {
			if (object.visible && object.userData['noAO'] === true) MutableList.append(found, object)
		})
		this.hidden = MutableList.toArray(found)
		for (const object of this.hidden) object.visible = false
	}

	_restoreVisibility() {
		for (const object of this.hidden) object.visible = true
		this.hidden = []
	}
}

// A smooth start and stop for the camera's glides.
function smoother(t: number) {
	const x = Number.clamp(t, {maximum: 1, minimum: 0})
	return x * x * x * (x * (x * 6 - 15) + 10)
}

// The fog's tile bits for one chunk, written into the window where they fall inside it.
function stamp(data: Uint8Array, corner: {x: number; z: number}, cx: number, cz: number, bits: Uint8Array) {
	const x0 = cx * CHUNK - corner.x
	const z0 = cz * CHUNK - corner.z
	if (x0 + CHUNK <= 0 || z0 + CHUNK <= 0 || x0 >= FOG_SIZE || z0 >= FOG_SIZE) return
	const from = Number.max(0, -x0)
	const to = Number.min(CHUNK, FOG_SIZE - x0)
	for (const row of Array.filter(Array.range(0, CHUNK - 1), entry => z0 + entry >= 0 && z0 + entry < FOG_SIZE)) {
		data.set(
			Array.map(Array.range(from, to - 1), column => {
				const index = row * CHUNK + column
				return (((bits[index >> 3] ?? 0) >> (index & 7)) & 1) * 255
			}),
			(z0 + row) * FOG_SIZE + x0 + from
		)
	}
}

// The world view: chunks streamed from a worker round the camera, fogged where the colony has not looked; an isometric camera that follows its subject, turned in quarter turns, in soft diorama light.
export function createRenderer(canvas: HTMLCanvasElement, seed: number) {
	const renderer = new THREE.WebGLRenderer({antialias: false, canvas, powerPreference: 'high-performance'})
	renderer.setPixelRatio(Number.min(window.devicePixelRatio, 2))
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.NeutralToneMapping
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFShadowMap
	const scene = new THREE.Scene()
	scene.background = FOG_UNKNOWN
	const fogData = new Uint8Array(FOG_SIZE * FOG_SIZE)
	const fogTexture = new THREE.DataTexture(fogData, FOG_SIZE, FOG_SIZE, THREE.RedFormat, THREE.UnsignedByteType)
	fogTexture.magFilter = THREE.LinearFilter
	fogTexture.minFilter = THREE.LinearFilter
	fogTexture.needsUpdate = true
	const fog = {
		uFog: {value: fogTexture},
		uFogSeen: {value: new THREE.Color('#d8d0c4')},
		uFogUnknown: {value: FOG_UNKNOWN},
		uFogWindow: {value: new THREE.Vector3(-FOG_SIZE / 2, -FOG_SIZE / 2, FOG_SIZE)},
		uSightCount: {value: 0},
		uSights: {value: Array.map(Array.range(1, SIGHTS), () => new THREE.Vector4())}
	}
	const explored = MutableHashMap.empty<number, Uint8Array>()
	const terrainMaterial = fogMaterial(
		new THREE.MeshStandardMaterial({metalness: 0, roughness: 0.92, vertexColors: true}),
		fog
	)
	const propMaterial = fogMaterial(
		new THREE.MeshStandardMaterial({metalness: 0, roughness: 0.82, vertexColors: true}),
		fog
	)
	const glowMaterial = fogMaterial(new THREE.MeshBasicMaterial({vertexColors: true}), fog)
	const time = {value: 0}
	const liquids = liquidMaterials(time, fog)
	const decor = decorations(fog)
	const sun = new THREE.DirectionalLight('#fff0dc', 2.5)
	sun.castShadow = true
	sun.shadow.mapSize.set(4096, 4096)
	sun.shadow.bias = -0.0006
	sun.shadow.normalBias = 0.03
	sun.shadow.radius = 4
	scene.add(sun, sun.target, new THREE.HemisphereLight('#eef4ff', '#d9c6ae', 1.35))
	const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600)
	const composer = new EffectComposer(
		renderer,
		new THREE.WebGLRenderTarget(1, 1, {samples: 4, type: THREE.HalfFloatType})
	)
	composer.addPass(new RenderPass(scene, camera))
	const occlusion = new Occlusion(scene, camera)
	occlusion.blendIntensity = 1
	occlusion.updateGtaoMaterial({distanceExponent: 1.5, radius: 0.5, samples: 12, scale: 1.2, thickness: 1})
	occlusion.updatePdMaterial({depthPhi: 2, lumaPhi: 10, normalPhi: 3, radius: 8, rings: 3, samples: 16})
	composer.addPass(occlusion)
	composer.addPass(new OutputPass())
	const worker = new Worker(new URL('./-chunks.worker.ts', import.meta.url), {type: 'module'})
	// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
	worker.postMessage({_tag: 'Seed', seed})
	const chunks = MutableHashMap.empty<number, Loaded>()
	const view = {
		azimuth: Math.PI / 4,
		busy: 0,
		quarter: 0,
		size: {height: 1, width: 1},
		target: new THREE.Vector3(0, 0, 0),
		zoom: ZOOM.start
	}
	// The camera's subject, where its glide to it started and how far along it is, the zoom the player picked and the zoom of a framed subject.
	const glide = {
		aim: {key: '', x: 0, y: 0, z: 0, zoom: Option.none<number>()} satisfies Aim,
		from: new THREE.Vector3(),
		progress: 1,
		zoom: {follow: ZOOM.start, framed: 1}
	}
	// The fog window's corner in tiles; it moves when the camera nears its edge.
	const fogCorner = {x: -FOG_SIZE / 2, z: -FOG_SIZE / 2}
	const clock = new THREE.Clock()
	const listeners = {all: Array.empty<(seconds: number, delta: number) => void>(), drawn: Array.empty<() => void>()}
	const raycaster = new THREE.Raycaster()
	const direction = new THREE.Vector3()

	function attachLiquid(group: THREE.Group, liquid: Built['liquids'][number]) {
		Option.match(
			Array.findFirst(liquids, entry => entry.kind === liquid.kind),
			{
				onNone: () => undefined,
				onSome: materials => {
					const surface = new THREE.BufferGeometry()
					surface.setAttribute('position', new THREE.BufferAttribute(liquid.positions, 3))
					surface.setAttribute('aS', new THREE.BufferAttribute(liquid.shore, 1))
					const top = new THREE.Mesh(surface, materials.surface)
					top.receiveShadow = true
					top.userData['noAO'] = true
					group.add(top)
					if (liquid.falls.byteLength === 0) return
					const falls = new THREE.BufferGeometry()
					falls.setAttribute('position', new THREE.BufferAttribute(liquid.falls, 3))
					falls.setAttribute('aF', new THREE.BufferAttribute(liquid.along, 3))
					const fall = new THREE.Mesh(falls, materials.fall)
					fall.userData['noAO'] = true
					group.add(fall)
				}
			}
		)
	}

	function attachInstances(group: THREE.Group, instances: Built['instances'][number]) {
		Option.match(MutableHashMap.get(decor, instances.key), {
			onNone: () => undefined,
			onSome: decoration => {
				const count = instances.data.length / 10
				const mesh = new THREE.InstancedMesh(decoration.geometry, decoration.material, count)
				const object = new THREE.Object3D()
				const shade = new THREE.Color()
				for (const n of Array.range(0, count - 1)) {
					const d = instances.data.subarray(n * 10, n * 10 + 10)
					object.position.set(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0)
					object.rotation.set(d[3] ?? 0, d[4] ?? 0, d[5] ?? 0)
					object.scale.set(d[6] ?? 1, d[7] ?? 1, d[8] ?? 1)
					object.updateMatrix()
					mesh.setMatrixAt(n, object.matrix)
					mesh.setColorAt(n, shade.setScalar(d[9] ?? 1))
				}
				mesh.castShadow = decoration.cast
				mesh.receiveShadow = true
				mesh.computeBoundingSphere()
				group.add(mesh)
			}
		})
	}

	function attach(built: Built) {
		const group = new THREE.Group()
		group.add(meshOf(built.terrain, terrainMaterial))
		if (built.props.positions.byteLength > 0) group.add(meshOf(built.props, propMaterial))
		if (built.glow.positions.byteLength > 0) {
			const glow = meshOf(built.glow, glowMaterial)
			glow.castShadow = false
			glow.userData['noAO'] = true
			group.add(glow)
		}
		for (const liquid of built.liquids) attachLiquid(group, liquid)
		for (const instances of built.instances) attachInstances(group, instances)
		scene.add(group)
		return group
	}

	// The worker is this page's own module: what it posts is a built chunk with the revision it was built from.
	worker.addEventListener('message', (event: MessageEvent<Built & {revision: number}>) => {
		view.busy = Number.max(0, view.busy - 1)
		const key = chunkKey(event.data.cx, event.data.cz)
		Option.match(MutableHashMap.get(chunks, key), {
			onNone: () => undefined,
			onSome: loaded => {
				disposeGroup(loaded.group)
				MutableHashMap.set(chunks, key, {
					built: Option.some(event.data),
					group: attach(event.data),
					revision: event.data.revision,
					wanted: loaded.wanted
				})
			}
		})
	})

	function groundOfNdc(x: number, y: number) {
		raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
		const hit = new THREE.Vector3()
		if (raycaster.ray.intersectPlane(new THREE.Plane(UP, -view.target.y), hit) === null) {
			return {x: view.target.x, z: view.target.z}
		}
		return {x: hit.x, z: hit.z}
	}

	// The ground rectangle in view, as chunk bounds with a margin.
	function visibleChunks(margin: number) {
		const corners = Array.map(NDC_CORNERS, corner => groundOfNdc(corner.x, corner.y))
		const reach = (view.zoom * view.size.width) / Number.max(1, view.size.height)
		const xs = [...Array.map(corners, point => point.x), view.target.x - reach, view.target.x + reach]
		const zs = [...Array.map(corners, point => point.z), view.target.z - reach, view.target.z + reach]
		return {
			cx0: Math.floor((lowest(xs) - margin * CHUNK) / CHUNK),
			cx1: Math.floor((highest(xs) + margin * CHUNK) / CHUNK),
			cz0: Math.floor((lowest(zs) - margin * CHUNK) / CHUNK),
			cz1: Math.floor((highest(zs) + margin * CHUNK) / CHUNK)
		}
	}

	function distanceTo(cx: number, cz: number) {
		return Math.hypot((cx + 0.5) * CHUNK - view.target.x, (cz + 0.5) * CHUNK - view.target.z)
	}

	// Asks the worker for a missing or stale chunk, two at a time, nearest the view's middle first.
	function request(cx: number, cz: number) {
		const key = chunkKey(cx, cz)
		const loaded = MutableHashMap.get(chunks, key)
		if (
			!Option.match(loaded, {
				onNone: () => true,
				onSome: entry => entry.revision < entry.wanted && entry.revision >= 0
			}) ||
			view.busy >= 2
		) {
			return
		}
		const wanted = Option.match(loaded, {onNone: () => 0, onSome: entry => entry.wanted})
		MutableHashMap.set(chunks, key, {
			built: Option.flatMap(loaded, entry => entry.built),
			group: Option.match(loaded, {onNone: () => new THREE.Group(), onSome: entry => entry.group}),
			revision: -1,
			wanted
		})
		view.busy += 1
		// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
		worker.postMessage({_tag: 'Build', cx, cz, revision: wanted})
	}

	// Drops a chunk that lies two chunks or more outside the view.
	function dropIfFar(key: number, keep: {cx0: number; cx1: number; cz0: number; cz1: number}) {
		const cx = Math.floor(key / 8192) - 4096
		const cz = (key % 8192) - 4096
		if (cx >= keep.cx0 && cx <= keep.cx1 && cz >= keep.cz0 && cz <= keep.cz1) return
		Option.match(MutableHashMap.get(chunks, key), {
			onNone: () => undefined,
			onSome: loaded => {
				if (loaded.revision < 0) return
				disposeGroup(loaded.group)
				MutableHashMap.remove(chunks, key)
			}
		})
	}

	function stream() {
		const near = visibleChunks(0)
		const wanted = Array.sort(
			Array.flatMap(Array.range(near.cz0, near.cz1), cz =>
				Array.map(Array.range(near.cx0, near.cx1), cx => ({cx, cz}))
			),
			(a: {cx: number; cz: number}, b: {cx: number; cz: number}) =>
				Number.sign(distanceTo(a.cx, a.cz) - distanceTo(b.cx, b.cz))
		)
		for (const chunk of wanted) request(chunk.cx, chunk.cz)
		const keep = visibleChunks(2)
		for (const key of Array.fromIterable(MutableHashMap.keys(chunks))) dropIfFar(key, keep)
	}

	function place() {
		if (canvas.clientWidth !== view.size.width || canvas.clientHeight !== view.size.height) {
			view.size = {height: canvas.clientHeight, width: canvas.clientWidth}
			renderer.setSize(view.size.width, view.size.height, false)
			composer.setSize(view.size.width, view.size.height)
		}
		direction.set(
			Math.sin(view.azimuth) * Math.cos(ELEVATION),
			Math.sin(ELEVATION),
			Math.cos(view.azimuth) * Math.cos(ELEVATION)
		)
		camera.position.copy(view.target).addScaledVector(direction, 200)
		camera.up.set(0, 1, 0)
		camera.lookAt(view.target)
		const aspect = view.size.width / Number.max(1, view.size.height)
		camera.top = view.zoom
		camera.bottom = -view.zoom
		camera.left = -view.zoom * aspect
		camera.right = view.zoom * aspect
		camera.updateProjectionMatrix()
		camera.updateMatrixWorld()
		// The sun's shadow covers the view and follows it.
		sun.position.copy(view.target).addScaledVector(SUN, 150)
		sun.target.position.copy(view.target)
		const reach = view.zoom * aspect * 1.3 + 4
		sun.shadow.camera.left = -reach
		sun.shadow.camera.right = reach
		sun.shadow.camera.top = reach
		sun.shadow.camera.bottom = -reach
		sun.shadow.camera.near = 1
		sun.shadow.camera.far = 400
		sun.shadow.camera.updateProjectionMatrix()
	}

	// The fog window recentres on the camera once it comes within a quarter of its edge, and redraws from every chunk explored so far.
	function recentre() {
		const half = FOG_SIZE / 2
		if (
			Math.abs(view.target.x - (fogCorner.x + half)) < half / 2 &&
			Math.abs(view.target.z - (fogCorner.z + half)) < half / 2
		) {
			return
		}
		fogCorner.x = Math.floor(view.target.x) - half
		fogCorner.z = Math.floor(view.target.z) - half
		fog.uFogWindow.value.set(fogCorner.x, fogCorner.z, FOG_SIZE)
		fogData.set(new Uint8Array(FOG_SIZE * FOG_SIZE))
		MutableHashMap.forEach(explored, (bits, key) =>
			stamp(fogData, fogCorner, Math.floor(key / 8192) - 4096, (key % 8192) - 4096, bits)
		)
		fogTexture.needsUpdate = true
	}

	// A new subject is reached in one smooth glide, or a cut when it is far; then the camera stays locked on it, so a moving unit never drifts off centre.
	function steer(delta: number) {
		glide.progress = Number.min(1, glide.progress + delta / GLIDE.seconds)
		const ease = smoother(glide.progress)
		view.target.set(
			glide.from.x + (glide.aim.x - glide.from.x) * ease,
			glide.from.y + (glide.aim.y - glide.from.y) * ease,
			glide.from.z + (glide.aim.z - glide.from.z) * ease
		)
		const zoom = Option.match(glide.aim.zoom, {
			onNone: () => glide.zoom.follow,
			onSome: framed => framed * glide.zoom.framed
		})
		view.zoom += (zoom - view.zoom) * (1 - Math.exp(-delta * 9))
	}

	function frame() {
		const delta = Number.min(clock.getDelta(), 0.1)
		const goal = Math.PI / 4 + (view.quarter * Math.PI) / 2
		view.azimuth += (goal - view.azimuth) * (1 - Math.exp(-delta * 12))
		if (Math.abs(goal - view.azimuth) < 1e-4) view.azimuth = goal
		time.value = clock.elapsedTime
		for (const listener of listeners.all) listener(clock.elapsedTime, delta)
		steer(delta)
		place()
		recentre()
		for (const listener of listeners.drawn) listener()
		stream()
		composer.render()
	}

	renderer.setAnimationLoop(frame)

	// Height of the ground in world units under a point, from the chunk the worker sent; none until it arrives.
	function heightAt(x: number, z: number) {
		const at = chunkOf(Math.floor(x), Math.floor(z))
		return Option.flatMap(MutableHashMap.get(chunks, chunkKey(at.cx, at.cz)), loaded =>
			Option.map(loaded.built, built => {
				const fx = x - Math.floor(x)
				const fz = z - Math.floor(z)
				const c = built.corners.subarray(at.index * 4, at.index * 4 + 4)
				return {
					ground:
						footing(
							((c[0] ?? 0) * (1 - fx) + (c[1] ?? 0) * fx) * (1 - fz) + ((c[2] ?? 0) * (1 - fx) + (c[3] ?? 0) * fx) * fz,
							built.deck[at.index] ?? Infinity
						) * LEVEL,
					liquid: built.liquid[at.index] ?? 0,
					surface: (built.surface[at.index] ?? 0) * LEVEL
				}
			})
		)
	}

	// Points the camera at a subject: a new key glides there from where the camera is, or cuts when it is far; the same key moves with it.
	function aim(next: Aim) {
		if (next.key !== glide.aim.key) {
			glide.from.copy(view.target)
			glide.progress = 0
			if (glide.aim.key === '' || Math.hypot(next.x - view.target.x, next.z - view.target.z) > GLIDE.cut) {
				glide.progress = 1
			}
			glide.zoom.framed = 1
		}
		glide.aim = next
	}

	return {
		aim,
		// Marks the chunks a tile change shows in for a rebuild, and passes the change to the worker.
		changes(changes: Frame['changes']) {
			if (Array.isReadonlyArrayEmpty(changes)) return
			// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
			worker.postMessage({_tag: 'Changes', changes})
			for (const change of changes) {
				for (const offset of REACH) {
					const at = chunkOf(change.x + offset.x, change.z + offset.z)
					Option.match(MutableHashMap.get(chunks, chunkKey(at.cx, at.cz)), {
						onNone: () => undefined,
						onSome: loaded => MutableHashMap.set(chunks, chunkKey(at.cx, at.cz), {...loaded, wanted: loaded.wanted + 1})
					})
				}
			}
		},
		dispose() {
			// oxlint-disable-next-line unicorn/no-null -- three's setAnimationLoop stops only on null.
			renderer.setAnimationLoop(null)
			worker.terminate()
			MutableHashMap.forEach(chunks, loaded => disposeGroup(loaded.group))
			composer.dispose()
			renderer.dispose()
		},
		// The explored tiles the server sent, kept per chunk and drawn into the fog window.
		explored(seen: Frame['explored']) {
			for (const chunk of seen) {
				MutableHashMap.set(explored, chunkKey(chunk.cx, chunk.cz), chunk.bits)
				stamp(fogData, fogCorner, chunk.cx, chunk.cz, chunk.bits)
			}
			if (Array.isReadonlyArrayNonEmpty(seen)) fogTexture.needsUpdate = true
		},
		// The place and half-height that frame a set of points on screen, with a margin, as the camera faces now.
		fit(points: {x: number; z: number}[]) {
			const right = {x: Math.cos(view.azimuth), z: -Math.sin(view.azimuth)}
			const ahead = {x: -Math.sin(view.azimuth), z: -Math.cos(view.azimuth)}
			const across = Array.map(points, point => point.x * right.x + point.z * right.z)
			const along = Array.map(points, point => point.x * ahead.x + point.z * ahead.z)
			const middle = {across: (lowest(across) + highest(across)) / 2, along: (lowest(along) + highest(along)) / 2}
			return {
				x: middle.across * right.x + middle.along * ahead.x,
				z: middle.across * right.z + middle.along * ahead.z,
				zoom: Number.clamp(
					Number.max(
						((highest(along) - lowest(along)) / 2) * Math.sin(ELEVATION) + 4,
						((highest(across) - lowest(across)) / 2 + 5) / (view.size.width / Number.max(1, view.size.height))
					),
					{maximum: ZOOM.farthest, minimum: ZOOM.start}
				)
			}
		},
		ground(x: number, z: number) {
			return Option.getOrElse(
				Option.map(heightAt(x, z), height => height.ground),
				() => view.target.y
			)
		},
		heightAt,
		// Runs once the camera has moved each frame, for what sits on screen over the world.
		onDrawn(listener: () => void) {
			listeners.drawn = [...listeners.drawn, listener]
		},
		// Runs before the camera moves each frame, for what it follows.
		onFrame(listener: (seconds: number, delta: number) => void) {
			listeners.all = [...listeners.all, listener]
		},
		project(x: number, y: number, z: number) {
			const point = new THREE.Vector3(x, y, z).project(camera)
			return {x: ((point.x + 1) / 2) * view.size.width, y: ((1 - point.y) / 2) * view.size.height}
		},
		scene,
		// The discs that are in sight now, in tiles: Home's and each unit's; past the shader's limit, the ones nearest the view.
		sight(discs: {radius: number; x: number; z: number}[]) {
			const shown = Array.take(
				Array.sortWith(
					discs,
					disc => Math.hypot(disc.x - view.target.x, disc.z - view.target.z) - disc.radius,
					Order.Number
				),
				SIGHTS
			)
			for (const entry of Array.map(shown, (disc, index) => ({disc, index}))) {
				fog.uSights.value[entry.index]?.set(entry.disc.x, entry.disc.z, entry.disc.radius, 0)
			}
			fog.uSightCount.value = shown.length
		},
		size() {
			return view.size
		},
		turn(quarters: number) {
			view.quarter += quarters
		},
		// Zooms the view by a factor: the zoom the player keeps, or a framed subject's for as long as it is framed.
		zoomBy(factor: number) {
			Option.match(glide.aim.zoom, {
				onNone: () => {
					glide.zoom.follow = Number.clamp(glide.zoom.follow * factor, {maximum: ZOOM.farthest, minimum: ZOOM.nearest})
				},
				onSome: framed => {
					glide.zoom.framed = Number.clamp(glide.zoom.framed * factor, {
						maximum: ZOOM.farthest / framed,
						minimum: ZOOM.nearest / framed
					})
				}
			})
		}
	}
}

export type Renderer = ReturnType<typeof createRenderer>
