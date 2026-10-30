import {Array, MutableHashMap, MutableList, Number, Option, Order, Predicate, Record, String, Tuple, pipe} from 'effect'

import * as THREE from 'three'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js'
import {OutlinePass} from 'three/addons/postprocessing/OutlinePass.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js'
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'

import type {Inspected, Stale} from './-chunks.worker.ts'
import type {Built} from './-mesh.ts'

import type {Frame} from '#services/game/schema.ts'
import {CHUNK, LEVEL, ORES, chunkOf, highest, lowest} from '#services/world/lib/utils.ts'

// Half the view's height in tiles: nearest, farthest the player zooms, the overview's and at the start.
const ZOOM = {farthest: 40, nearest: 3.5, overview: 90, start: 12}
// The zone map's side in chunks, centred on the world's origin.
const ZONES = 128
// A chunk's revision as sent to a builder: the world's epoch times this, plus its own.
const EPOCH = 1_000_000
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
// The tallest the fog and the smog stand over the ground, in world units, and the steps a ray takes through them.
const VOLUME = {steps: 28, top: 4}
// Where a tile has worn: the window of the wear map a texel a tile, read by the ground and the grass on it.
const WEAR = `
uniform sampler2D uEnv; uniform vec3 uWindow;
float wearAt(vec2 xz){ vec2 uv = (xz - uWindow.xy) / uWindow.z; return texture2D(uEnv, uv).g * step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.); }`
// The atmosphere, drawn over the finished frame from its depth. A ray from the camera to each pixel's surface marches through two volumes: fog over the unexplored, thin at the explored edge and thickening into a cloud bank the farther it lies from it, and smog where the colony has worked. Explored ground out of sight is greyed; Home's and the units' sight is clear.
const ATMOSPHERE = `
uniform sampler2D tDiffuse, tDepth, uKnown, uEnv, uGround, uZones; uniform mat4 uInv; uniform vec3 uDir, uWindow; uniform float uT, uFogOn;
uniform vec4 uSights[${SIGHTS}]; uniform int uSightCount, uFogStyle, uSmogStyle;
varying vec2 vUv;
float n3(vec3 p){ float i = floor(p.y), f = fract(p.y); f = f * f * (3. - 2. * f); return mix(vn(p.xz + i * vec2(17.13, 31.71)), vn(p.xz + (i + 1.) * vec2(17.13, 31.71)), f); }
float fbm(vec3 p){ return n3(p) * .52 + n3(p * 2.03 + 7.1) * .3 + n3(p * 4.11 + 3.3) * .18; }
vec2 windowUv(vec2 xz){ return (xz - uWindow.xy) / uWindow.z; }
// Explored (0 to 1) and tiles from the explored edge, outside the window unexplored and far.
vec2 knownAt(vec2 xz){
	vec2 uv = windowUv(xz + (vec2(vn(xz * .23), vn(xz * .23 + 19.7)) - .5) * 3.);
	float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
	vec2 k = texture2D(uKnown, uv).rg;
	return vec2(smoothstep(.25, .75, k.r) * inside, mix(64., k.g * 64., inside));
}
float seenAt(vec2 xz){
	float n = (vn(xz * .31) - .5) * 3.4 + (vn(xz * 1.1 + 7.1) - .5) * .9, seen = 0.;
	for (int i = 0; i < ${SIGHTS}; i++){ if (i >= uSightCount) break; vec4 s = uSights[i]; seen = max(seen, 1. - smoothstep(s.z - 3., s.z, length(xz - s.xy) + n)); }
	return seen;
}
float smogAt(vec2 xz){ vec2 uv = windowUv(xz); return texture2D(uEnv, uv).r * step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.); }
void main(){
	vec4 c = texture2D(tDiffuse, vUv);
	float d = texture2D(tDepth, vUv).x, sky = step(.9999, d);
	vec4 w = uInv * vec4(vUv * 2. - 1., d * 2. - 1., 1.); w /= w.w;
	vec4 n = uInv * vec4(vUv * 2. - 1., -1., 1.); n /= n.w;
	// Where the pixel's ray meets the ground plane: the surface under the sky, and the noise's anchor so nothing tall drags it.
	vec3 plane = n.xyz - uDir * (n.y / uDir.y);
	vec3 surface = mix(w.xyz, plane, sky);
	float seen = 0.;
	if (uFogOn > 0.) seen = max(seenAt(surface.xz), seenAt(plane.xz));
	// Explored ground looks the same in sight or out of it: only the unexplored lies under fog.
	vec3 base = c.rgb;
	// With the fog off, each chunk a team has stood in takes a light wash of its colour, a little stronger at the chunk's edge.
	vec2 zc = surface.xz / ${CHUNK.toFixed(1)}, zf = fract(zc), zuv = (floor(zc) + ${(ZONES / 2).toFixed(1)} + .5) / ${ZONES.toFixed(1)};
	vec4 zone = texture2D(uZones, zuv) * step(0., zuv.x) * step(zuv.x, 1.) * step(0., zuv.y) * step(zuv.y, 1.);
	float zedge = 1. - smoothstep(.0, .025, min(min(zf.x, zf.y), min(1. - zf.x, 1. - zf.y)));
	base = mix(base, zone.rgb, zone.a * (.14 + .3 * zedge) * (1. - uFogOn) * (1. - sky));
	if (uSmogStyle == 0 && (uFogOn == 0. || seen >= 1.)) { gl_FragColor = vec4(base, c.a); return; }
	float smogHere = smogAt(surface.xz);
	if (uSmogStyle == 2) base = mix(base, vec3(dot(base, vec3(.3, .55, .15))) * vec3(1., .82, .52) * .85, smoothstep(.08, .55, smogHere) * .85);
	// Through the volumes, from the top of the tallest down to the surface; they stand on the ground under it, so whatever is tall rises through them.
	vec2 gv = windowUv(surface.xz);
	float inWindow = step(0., gv.x) * step(gv.x, 1.) * step(0., gv.y) * step(gv.y, 1.) * (1. - sky);
	// Ground not built yet reads far below; nothing on the ground stands more than three units tall.
	float g = texture2D(uGround, gv).r;
	float bed = mix(surface.y, max(min(surface.y, g), surface.y - 3.), inWindow * step(-500., g));
	float top = ${VOLUME.top.toFixed(1)}, L = max(0., bed + top - surface.y) / -uDir.y, ds = L / ${VOLUME.steps.toFixed(1)};
	float T = 1.; vec3 acc = vec3(0);
	vec3 fogLow = uFogStyle == 1 ? vec3(.002, .003, .006) : vec3(.42, .46, .56), fogHigh = uFogStyle == 1 ? vec3(.03, .036, .055) : vec3(1., 1., 1.);
	vec3 smogLow = uSmogStyle == 3 ? vec3(.05, .045, .045) : vec3(.3, .24, .14), smogHigh = uSmogStyle == 3 ? vec3(.3, .28, .27) : vec3(.74, .62, .4);
	for (int i = 0; i < ${VOLUME.steps}; i++){
		vec3 p = surface - uDir * (L * (1. - (float(i) + .5) / ${VOLUME.steps.toFixed(1)}));
		float h = p.y - bed;
		vec2 kp = knownAt(p.xz);
		float far = smoothstep(0., 18., kp.y);
		float fogTop = mix(.35, top, far) * (.45 + .75 * fbm(vec3(p.x * .045 + uT * .015, uT * .01, p.z * .045)));
		float drift = fbm(p * .16 + vec3(uT * .05, uT * .01, uT * .035));
		float fog = uFogOn * (1. - max(kp.x, seen)) * smoothstep(fogTop, fogTop - 1.4, h) * (.35 + .65 * drift) * mix(.45, 1.6, far);
		float mist = 0.;
		float s = uSmogStyle == 0 ? 0. : smogAt(p.xz);
		float smogTop = uSmogStyle == 3 ? .45 + 4.2 * s : uSmogStyle == 2 ? .3 + 1.6 * s : .4 + 3.2 * s;
		float wisp = 0.;
		if (s > 0.) wisp = uSmogStyle == 3 ? fbm(vec3(p.x * .45, p.y * .22 - uT * .6, p.z * .45)) : fbm(p * .3 + vec3(uT * .22, uT * .06, uT * .15));
		float smog = s * smoothstep(smogTop, smogTop - (uSmogStyle == 3 ? 2.6 : 1.2), h) * smoothstep(.2, .75, wisp + s * (uSmogStyle == 3 ? .7 : .35)) * (uSmogStyle == 2 ? 1.8 : uSmogStyle == 3 ? 4. : 3.2);
		float sigma = fog * 1.1 + mist + smog;
		if (sigma > .0001) {
			float a = 1. - exp(-sigma * ds);
			// Tops catch the light and troughs sit in their shade: brightness by height under the tallest the bank stands, and the bank's own shadow a step towards the sun.
			float lit = smoothstep(0., top, h) * .75 + .25 * fbm(p * .3 + 11.);
			lit *= 1. - .45 * smoothstep(fogTop - 1.6, fogTop - .2, h + .9) * (1. - smoothstep(.3, .9, fbm(p * .16 + vec3(.6, .9, -.5) + vec3(uT * .05, uT * .01, uT * .035))));
			vec3 col = (fog * 1.1 * mix(fogLow, fogHigh, lit) + mist * vec3(.93, .94, .96) + smog * mix(smogLow, smogHigh, smoothstep(0., smogTop, h) * .7 + .3 * wisp)) / sigma;
			acc += T * a * col; T *= 1. - a;
		}
	}
	gl_FragColor = vec4(base * T + acc, c.a);
}`

// The camera looks down 30° and turns only in the quarter turns the player asks for.
const ELEVATION = (30 * Math.PI) / 180
const SUN = new THREE.Vector3(-0.35, 0.8, 0.45).normalize()
const UP = new THREE.Vector3(0, 1, 0)
// The ground height map's mark for ground no chunk has built yet.
const UNBUILT = THREE.DataUtils.toHalfFloat(-1000)

type Loaded = {built: Option.Option<Built>; group: THREE.Group; revision: number; wanted: number}
type Clock = {value: number}
type Uniforms = Record<string, THREE.IUniform>
// Where the camera goes: a key per subject, so a new subject glides there and the same one stays locked on; a zoom when the subject sets one.
export type Aim = {key: string; x: number; y: number; z: number; zoom: Option.Option<number>}

function waterMaterial(time: Clock, colours: {deep: string; foam: string; shallow: string}) {
	return new THREE.ShaderMaterial({
		fragmentShader: `uniform float uT; uniform vec3 uA, uB, uF; varying float vS; varying vec3 vW; ${NOISE}
			void main(){
				if (vS < -.5) { gl_FragColor = vec4(uB * .82, 1.); return; }
				float s = vS, wob = .045 * sin(vW.x * 3.1 + uT * 1.3) + .03 * sin(vW.z * 4.3 - uT * 1.1);
				vec3 c = mix(uA, uB, smoothstep(0., 1.1, s + wob * .6));
				float lip = 1. - smoothstep(.03, .1, s);
				float band = 1. - smoothstep(0., .05, abs(s - .16 - .05 * sin(uT * 1.1) - wob * .4));
				float sp = smoothstep(.93, .97, vn(vec2(vW.x * 5. + uT * .4, vW.z * 5. - uT * .3))) * smoothstep(.2, .6, s);
				c = mix(c, uF, max(lip, band * .55)) + sp * .35;
				gl_FragColor = vec4(c, 1.);
				#include <colorspace_fragment>
			}`,
		side: THREE.DoubleSide,
		uniforms: {
			uA: {value: new THREE.Color(colours.shallow)},
			uB: {value: new THREE.Color(colours.deep)},
			uF: {value: new THREE.Color(colours.foam)},
			uT: time
		},
		vertexShader: `attribute float aS; varying float vS; varying vec3 vW; void main(){ vS = aS; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
	})
}

// Falls: aF is (along the edge, distance below the lip, total height); mode 0 water, 1 lava, 2 ice.
function fallMaterial(time: Clock, mode: number, colours: {a: string; b: string; foam: string}) {
	return new THREE.ShaderMaterial({
		fragmentShader: `uniform float uT; uniform vec3 uA, uB, uF; uniform int uMode; varying vec3 vF; varying vec3 vW; ${NOISE}
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
				gl_FragColor = vec4(c, 1.);
				#include <colorspace_fragment>
			}`,
		side: THREE.DoubleSide,
		uniforms: {
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
function liquidMaterials(time: Clock) {
	return [
		{
			fall: fallMaterial(time, 0, {a: '#c4ece8', b: '#82cfd1', foam: '#ffffff'}),
			kind: 1,
			surface: waterMaterial(time, {deep: '#6fc3c8', foam: '#ffffff', shallow: '#a8e0dc'})
		},
		{
			fall: fallMaterial(time, 1, {a: '#ff8a5b', b: '#ffd59a', foam: '#9a6a5c'}),
			kind: 2,
			surface: new THREE.ShaderMaterial({
				fragmentShader: `uniform float uT; uniform vec3 uA, uB, uC; varying vec3 vW; ${NOISE}
					void main(){
						vec2 p = vec2(vW.x * 2.6 + vW.y, vW.z * 1.6 - uT * .35);
						vec3 v = vor(p + vec2(vn(p * .7 + uT * .1) * .6, 0.));
						float hot = vn(vec2(vW.x * 3., vW.z * 2. - uT * .8)) * .6 + .4 * sin(uT * 2. + vW.z * 3.);
						float crack = 1. - smoothstep(.06, .22, v.x);
						vec3 c = mix(uC * (1. + .2 * v.y), uA, crack); c = mix(c, uB, crack * smoothstep(.3, .9, hot)) + uA * .25;
						gl_FragColor = vec4(c, 1.);
						#include <colorspace_fragment>
					}`,
				side: THREE.DoubleSide,
				uniforms: {
					uA: {value: new THREE.Color('#ff8a5b')},
					uB: {value: new THREE.Color('#ffd59a')},
					uC: {value: new THREE.Color('#9a6a5c')},
					uT: time
				},
				vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
			})
		},
		{
			fall: fallMaterial(time, 2, {a: '#eaf8fb', b: '#93cbe0', foam: '#ffffff'}),
			kind: 3,
			surface: waterMaterial(time, {deep: '#a6d8e8', foam: '#ffffff', shallow: '#e4f5f9'})
		},
		{
			fall: fallMaterial(time, 0, {a: '#f8e98f', b: '#ecd055', foam: '#fff9d6'}),
			kind: 4,
			surface: waterMaterial(time, {deep: '#ecd055', foam: '#fff9d6', shallow: '#f8e98f'})
		},
		{
			fall: fallMaterial(time, 0, {a: '#c8f3ec', b: '#7ed6cf', foam: '#ffffff'}),
			kind: 5,
			surface: waterMaterial(time, {deep: '#7ed6cf', foam: '#ffffff', shallow: '#c8f3ec'})
		},
		{
			fall: fallMaterial(time, 0, {a: '#bff3f0', b: '#5fd0d6', foam: '#fbf3e4'}),
			kind: 6,
			surface: waterMaterial(time, {deep: '#45c3d3', foam: '#fbf3e4', shallow: '#a6ece6'})
		},
		{
			fall: fallMaterial(time, 0, {a: '#b9f1e6', b: '#6fd8cf', foam: '#ffffff'}),
			kind: 7,
			surface: waterMaterial(time, {deep: '#5cc9cf', foam: '#ffffff', shallow: '#b5efe2'})
		}
	]
}

/* oxlint-disable no-param-reassign -- three takes onBeforeCompile off the material and hands it the shader to edit in place. */
// Wears a lit three material where the colony keeps passing: the ground's tops turn to trodden earth, then a dirt track, and the grass on them goes.
function wornMaterial<M extends THREE.Material>(material: M, env: Uniforms, part: 'cover' | 'ground') {
	const wear = {
		cover: {
			at: '#include <clipping_planes_fragment>',
			glsl: '#include <clipping_planes_fragment>\nif (wearAt(vWearW.xz) + (vn(vWearW.xz * 4.7) - .5) * .3 > .32) discard;'
		},
		ground: {
			at: '#include <color_fragment>',
			glsl: '#include <color_fragment>\nfloat worn = smoothstep(.12, .5, wearAt(vWearW.xz) + (vn(vWearW.xz * 3.1) - .5) * .22) * smoothstep(.7, .9, vWearUp);\nfloat track = smoothstep(.5, .85, wearAt(vWearW.xz) + (vn(vWearW.xz * 5.3 + 4.) - .5) * .2);\ndiffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * vec3(.86, .78, .64), vec3(.42, .33, .24), track * .8), worn);'
		}
	}[part]
	material.onBeforeCompile = shader => {
		for (const entry of Record.toEntries(env)) shader.uniforms[entry[0]] = entry[1]
		shader.vertexShader = pipe(
			shader.vertexShader,
			String.replace('#include <common>', '#include <common>\nvarying vec3 vWearW;\nvarying float vWearUp;'),
			String.replace(
				'#include <project_vertex>',
				'#include <project_vertex>\nvec4 wearAt = vec4(transformed, 1.);\n#ifdef USE_INSTANCING\nwearAt = instanceMatrix * wearAt;\n#endif\nvWearW = (modelMatrix * wearAt).xyz;\nvWearUp = normalize(mat3(modelMatrix) * objectNormal).y;'
			)
		)
		shader.fragmentShader = pipe(
			shader.fragmentShader,
			String.replace(
				'#include <common>',
				`#include <common>\nvarying vec3 vWearW;\nvarying float vWearUp;${NOISE}${WEAR}`
			),
			String.replace(wear.at, wear.glsl)
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
	if (shape === 'orb') return new THREE.SphereGeometry(1, 8, 6)
	return new THREE.BoxGeometry(1, 1, 1)
}

function standard(colour: string, glow: boolean) {
	if (glow) {
		return new THREE.MeshStandardMaterial({color: colour, emissive: colour, emissiveIntensity: 0.8, roughness: 0.6})
	}
	return new THREE.MeshStandardMaterial({color: colour, metalness: 0, roughness: 0.78})
}

// Each instanced decoration the mesher places: its shape, its material and whether it casts a shadow; grass and reeds go where the ground wears.
function decorations(env: Uniforms) {
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
			material: wornMaterial(standard('#93c27d', false), env, 'cover')
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
			material: wornMaterial(standard('#a9bf83', false), env, 'cover')
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
		Array.map([...fixed, ...ores], decoration => Tuple.make(decoration.key, decoration))
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

// A two-channel map over the window round the camera, a texel a tile, filtered between tiles.
function windowTexture(data: Uint8Array) {
	const texture = new THREE.DataTexture(data, FOG_SIZE, FOG_SIZE, THREE.RGFormat, THREE.UnsignedByteType)
	texture.magFilter = THREE.LinearFilter
	texture.minFilter = THREE.LinearFilter
	texture.needsUpdate = true
	return texture
}

// A texel's starting distance: none where explored, far where not.
function unexplored(value: number) {
	if (value > 127) return 0
	return 1e4
}

/* oxlint-disable no-param-reassign -- the distances and the known map are rewritten in place each time the explored map changes. */
// A texel's distance, shortened through a neighbour's `cost` tiles away.
function relax(distance: Float32Array, index: number, from: number, cost: number) {
	const through = (distance[from] ?? 1e4) + cost
	if (through < (distance[index] ?? 1e4)) distance[index] = through
}

// The pass down the window at a texel: through the neighbours already passed, west and north.
function fromBefore(distance: Float32Array, x: number, z: number) {
	const index = z * FOG_SIZE + x
	if (x > 0) relax(distance, index, index - 1, 1)
	if (z > 0) relax(distance, index, index - FOG_SIZE, 1)
	if (x > 0 && z > 0) relax(distance, index, index - FOG_SIZE - 1, Math.SQRT2)
	if (x < FOG_SIZE - 1 && z > 0) relax(distance, index, index - FOG_SIZE + 1, Math.SQRT2)
}

// The pass back up at a texel: through the neighbours east and south.
function fromAfter(distance: Float32Array, x: number, z: number) {
	const index = z * FOG_SIZE + x
	if (x < FOG_SIZE - 1) relax(distance, index, index + 1, 1)
	if (z < FOG_SIZE - 1) relax(distance, index, index + FOG_SIZE, 1)
	if (x < FOG_SIZE - 1 && z < FOG_SIZE - 1) relax(distance, index, index + FOG_SIZE + 1, Math.SQRT2)
	if (x > 0 && z < FOG_SIZE - 1) relax(distance, index, index + FOG_SIZE - 1, Math.SQRT2)
}

// Beside each texel's explored bit, how many tiles it lies from the nearest explored one: a chamfer pass down the window and one back up, stored at a quarter tile and saturating at 63.
function reach(explored: Uint8Array, known: Uint8Array) {
	const distance = Float32Array.from(explored, unexplored)
	const down = Array.range(0, FOG_SIZE - 1)
	for (const z of down) {
		for (const x of down) fromBefore(distance, x, z)
	}
	const up = Array.reverse(down)
	for (const z of up) {
		for (const x of up) fromAfter(distance, x, z)
	}
	for (const index of Array.range(0, FOG_SIZE * FOG_SIZE - 1)) {
		known[index * 2] = explored[index] ?? 0
		known[index * 2 + 1] = Number.min(255, (distance[index] ?? 1e4) * 4)
	}
}
/* oxlint-enable no-param-reassign */

// The world view: chunks streamed from a worker round the camera, fogged where the colony has not looked; an isometric camera that follows its subject, turned in quarter turns, in soft diorama light.
export function createRenderer(canvas: HTMLCanvasElement, seed: number) {
	const renderer = new THREE.WebGLRenderer({antialias: false, canvas, powerPreference: 'high-performance'})
	renderer.setPixelRatio(Number.min(window.devicePixelRatio, 2))
	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.NeutralToneMapping
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFShadowMap
	const scene = new THREE.Scene()
	scene.background = new THREE.Color('#f2f2f4')
	const exploredData = new Uint8Array(FOG_SIZE * FOG_SIZE)
	const knownData = new Uint8Array(FOG_SIZE * FOG_SIZE * 2)
	const knownTexture = windowTexture(knownData)

	const envTexture = windowTexture(new Uint8Array(FOG_SIZE * FOG_SIZE * 2))
	// The texture keeps its array, so a reset copies this unbuilt window into it.
	const unbuilt = Uint16Array.from(Array.replicate(UNBUILT, FOG_SIZE * FOG_SIZE))
	// The ground's height over the window, a texel a tile: the volumes stand on the ground, so a tree rises through them rather than lifting them.
	const groundData = Uint16Array.from(unbuilt)
	const groundTexture = new THREE.DataTexture(groundData, FOG_SIZE, FOG_SIZE, THREE.RedFormat, THREE.HalfFloatType)
	groundTexture.magFilter = THREE.LinearFilter
	groundTexture.minFilter = THREE.LinearFilter
	groundTexture.needsUpdate = true
	const time = {value: 0}
	const env = {uEnv: {value: envTexture}, uWindow: {value: new THREE.Vector3(-FOG_SIZE / 2, -FOG_SIZE / 2, FOG_SIZE)}}
	const sights = {
		uSightCount: {value: 0},
		uSights: {value: Array.map(Array.range(1, SIGHTS), () => new THREE.Vector4())}
	}
	const explored = MutableHashMap.empty<number, Uint8Array>()
	const terrainMaterial = wornMaterial(
		new THREE.MeshStandardMaterial({metalness: 0, roughness: 0.92, vertexColors: true}),
		env,
		'ground'
	)
	const propMaterial = new THREE.MeshStandardMaterial({metalness: 0, roughness: 0.82, vertexColors: true})
	const glowMaterial = new THREE.MeshBasicMaterial({vertexColors: true})
	const liquids = liquidMaterials(time)
	const decor = decorations(env)
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
	// The followed unit's mark: a strong edge in its team's colour, fainter where something stands in front of it. Every unit's thin team edge is its own hull, drawn by the cast.
	const outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera)
	outline.hiddenEdgeColor.set('#8a8a8a')
	outline.edgeStrength = 4
	outline.edgeThickness = 1
	outline.edgeGlow = 0
	composer.addPass(outline)
	// The zones teams have stood in, a texel a chunk: their colours mixed, and how much shows.
	const zoneData = new Uint8Array(ZONES * ZONES * 4)
	const zoneTexture = new THREE.DataTexture(zoneData, ZONES, ZONES, THREE.RGBAFormat, THREE.UnsignedByteType)
	zoneTexture.colorSpace = THREE.SRGBColorSpace
	zoneTexture.needsUpdate = true
	const fogOn = {value: 1}
	const inverse = new THREE.Matrix4()
	const facing = new THREE.Vector3(0, -1, 0)
	composer.addPass(
		new ShaderPass(
			new THREE.ShaderMaterial({
				fragmentShader: `${NOISE}${ATMOSPHERE}`,
				uniforms: {
					...env,
					...sights,
					tDepth: {value: occlusion.depthTexture},
					tDiffuse: {value: undefined},
					uDir: {value: facing},
					uFogOn: fogOn,
					uFogStyle: {value: 0},
					uGround: {value: groundTexture},
					uInv: {value: inverse},
					uKnown: {value: knownTexture},
					uSmogStyle: {value: 0},
					uT: time,
					uZones: {value: zoneTexture}
				},
				vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`
			})
		)
	)
	composer.addPass(new OutputPass())
	// Three chunk builders, each with how many chunks it is building; every one hears the seed and the world's changes.
	const builders = Array.map(Array.range(1, 3), () => ({
		busy: 0,
		worker: new Worker(new URL('./-chunks.worker.ts', import.meta.url), {type: 'module'})
	}))
	function tell(message: unknown) {
		// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
		for (const builder of builders) builder.worker.postMessage(message)
	}
	tell({_tag: 'Seed', seed})
	const chunks = MutableHashMap.empty<number, Loaded>()
	const view = {
		azimuth: Math.PI / 4,
		// How many times the world started over; a chunk's revision carries the one it was asked in.
		epoch: 0,
		quarter: 0,
		size: {height: 1, width: 1},
		target: new THREE.Vector3(0, 0, 0),
		zoom: ZOOM.start
	}
	// The camera's subject, where its glide to it started and how far along it is, the zoom the player picked and the zoom of a framed subject.
	const glide = {
		aim: {key: '', x: 0, y: 0, z: 0, zoom: Option.none<number>()} satisfies Aim,
		from: new THREE.Vector3(),
		// How far the player dragged the view off its subject; a new subject starts centred.
		offset: new THREE.Vector3(),
		progress: 1,
		zoom: {follow: ZOOM.start, framed: 1}
	}
	// The fog window's corner in tiles; it moves when the camera nears its edge.
	const fogCorner = {x: -FOG_SIZE / 2, z: -FOG_SIZE / 2}
	const clock = new THREE.Clock()
	const listeners = {all: Array.empty<(seconds: number, delta: number) => void>(), drawn: Array.empty<() => void>()}
	const raycaster = new THREE.Raycaster()
	const direction = new THREE.Vector3()
	// The latest tile asked about under the pointer; answers to older asks are dropped.
	const inspection = {ask: 0, listeners: Array.empty<(answer: Inspected) => void>()}

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

	// A chunk's ground heights, written into the window where they fall inside it.
	function paintGround(cx: number, cz: number) {
		for (const row of Array.range(0, CHUNK - 1)) {
			const z = cz * CHUNK + row
			for (const column of Array.range(0, CHUNK - 1)) {
				const x = cx * CHUNK + column
				const tx = x - fogCorner.x
				const tz = z - fogCorner.z
				if (tx >= 0 && tz >= 0 && tx < FOG_SIZE && tz < FOG_SIZE) {
					groundData[tz * FOG_SIZE + tx] = Option.getOrElse(
						Option.map(heightAt(x + 0.5, z + 0.5), height => THREE.DataUtils.toHalfFloat(height.ground)),
						() => UNBUILT
					)
				}
			}
		}
		groundTexture.needsUpdate = true
	}

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

	// A chunk built with props since cleared builds again.
	function stale(cx: number, cz: number) {
		Option.match(MutableHashMap.get(chunks, chunkKey(cx, cz)), {
			onNone: () => undefined,
			onSome: loaded => MutableHashMap.set(chunks, chunkKey(cx, cz), {...loaded, wanted: loaded.wanted + 1})
		})
	}

	// The workers are this page's own module: what one posts is a built chunk with the revision it was built from, the chunks it built with props since cleared, or what lies on a tile asked about.
	function received(from: number, message: (Built & {revision: number}) | Inspected | Stale) {
		if (Predicate.hasProperty(message, '_tag')) {
			if (message._tag === 'Stale') {
				for (const chunk of message.chunks) stale(chunk.cx, chunk.cz)
			}
			if (message._tag === 'Inspected' && message.ask === inspection.ask) {
				for (const listener of inspection.listeners) listener(message)
			}
			return
		}
		const builder = builders[from]
		if (builder !== undefined) builder.busy = Number.max(0, builder.busy - 1)
		// A chunk asked for before the world started over is of the old world.
		if (Math.floor(message.revision / EPOCH) !== view.epoch) return
		const key = chunkKey(message.cx, message.cz)
		Option.match(MutableHashMap.get(chunks, key), {
			onNone: () => undefined,
			onSome: loaded => {
				disposeGroup(loaded.group)
				MutableHashMap.set(chunks, key, {
					built: Option.some(message),
					group: attach(message),
					revision: message.revision % EPOCH,
					wanted: loaded.wanted
				})
				paintGround(message.cx, message.cz)
			}
		})
	}
	Array.forEach(builders, (builder, index) => {
		builder.worker.addEventListener(
			'message',
			(event: MessageEvent<(Built & {revision: number}) | Inspected | Stale>) => received(index, event.data)
		)
	})

	// Where the pointer's ray meets the ground: down the camera's ray from the highest terrace, a fifth of a tile at a time, to the first point at or under the ground.
	function groundUnder(clientX: number, clientY: number) {
		const box = renderer.domElement.getBoundingClientRect()
		raycaster.setFromCamera(
			new THREE.Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1),
			camera
		)
		const ray = raycaster.ray
		const start = Number.max(0, (ray.origin.y - (view.target.y + 40)) / -ray.direction.y)
		function pointAt(step: number) {
			// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- THREE.Ray's own at, the point a distance along it.
			return ray.at(start + step * 0.2, new THREE.Vector3())
		}
		return Option.map(
			Array.findFirst(Array.range(0, 2000), step => {
				const point = pointAt(step)
				return Option.exists(heightAt(point.x, point.z), height => point.y <= height.ground)
			}),
			step => {
				const point = pointAt(step)
				const across = Number.max(1e-6, Math.hypot(ray.direction.x, ray.direction.z))
				return {back: {x: -ray.direction.x / across, z: -ray.direction.z / across}, x: point.x, z: point.z}
			}
		)
	}

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
		const across = (view.zoom * view.size.width) / Number.max(1, view.size.height)
		const xs = [...Array.map(corners, point => point.x), view.target.x - across, view.target.x + across]
		const zs = [...Array.map(corners, point => point.z), view.target.z - across, view.target.z + across]
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

	// Asks the least busy builder for a missing or stale chunk, a few at a time each, nearest the view's middle first.
	function request(cx: number, cz: number) {
		const key = chunkKey(cx, cz)
		const loaded = MutableHashMap.get(chunks, key)
		if (Option.exists(loaded, entry => entry.revision < 0 || entry.revision >= entry.wanted)) return
		const builder = Option.getOrUndefined(
			Array.head(
				Array.sortWith(
					// Each builds two chunks at once at most.
					Array.filter(builders, entry => entry.busy < 2),
					(entry: {busy: number}) => entry.busy,
					Order.Number
				)
			)
		)
		if (
			!Option.match(loaded, {
				onNone: () => true,
				onSome: entry => entry.revision < entry.wanted && entry.revision >= 0
			}) ||
			builder === undefined
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
		builder.busy += 1
		// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
		builder.worker.postMessage({_tag: 'Build', cx, cz, revision: view.epoch * EPOCH + wanted})
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
		const cover = view.zoom * aspect * 1.3 + 4
		sun.shadow.camera.left = -cover
		sun.shadow.camera.right = cover
		sun.shadow.camera.top = cover
		sun.shadow.camera.bottom = -cover
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
		env.uWindow.value.set(fogCorner.x, fogCorner.z, FOG_SIZE)
		exploredData.set(new Uint8Array(exploredData.length))
		MutableHashMap.forEach(explored, (bits, key) =>
			stamp(exploredData, fogCorner, Math.floor(key / 8192) - 4096, (key % 8192) - 4096, bits)
		)
		reach(exploredData, knownData)
		knownTexture.needsUpdate = true
		groundData.set(unbuilt)
		MutableHashMap.forEach(chunks, (_, key) => paintGround(Math.floor(key / 8192) - 4096, (key % 8192) - 4096))
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
		view.target.add(glide.offset)
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
		inverse.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
		camera.getWorldDirection(facing)
		composer.render()
	}

	renderer.setAnimationLoop(frame)

	// Points the camera at a subject: a new key glides there from where the camera is, or cuts when it is far; the same key moves with it.
	function aim(next: Aim) {
		if (next.key !== glide.aim.key) {
			glide.from.copy(view.target)
			glide.offset.set(0, 0, 0)
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
		// The ground's right and ahead as the camera faces now, for keys that steer on screen.
		axes() {
			return {
				ahead: {x: -Math.sin(view.azimuth), z: -Math.cos(view.azimuth)},
				right: {x: Math.cos(view.azimuth), z: -Math.sin(view.azimuth)}
			}
		},
		// Back onto the subject.
		centre() {
			glide.from.copy(view.target)
			glide.progress = 0
			glide.offset.set(0, 0, 0)
		},
		// Marks the chunks a tile change shows in for a rebuild, and passes the change to the builders.
		changes(changes: Frame['changes']) {
			if (Array.isReadonlyArrayEmpty(changes)) return
			tell({_tag: 'Changes', changes})
			for (const change of changes) {
				for (const offset of REACH) {
					const at = chunkOf(change.x + offset.x, change.z + offset.z)
					stale(at.cx, at.cz)
				}
			}
		},
		// Props the colonies cleared: the builders drop them and name the chunks to build again.
		cleared(ids: Frame['cleared']) {
			if (Array.isReadonlyArrayNonEmpty(ids)) tell({_tag: 'Cleared', ids})
		},
		dispose() {
			// oxlint-disable-next-line unicorn/no-null -- three's setAnimationLoop stops only on null.
			renderer.setAnimationLoop(null)
			for (const builder of builders) builder.worker.terminate()
			MutableHashMap.forEach(chunks, loaded => disposeGroup(loaded.group))
			composer.dispose()
			renderer.dispose()
		},
		// The explored tiles the server sent, kept per chunk and drawn into the fog window.
		explored(seen: Frame['explored']) {
			for (const chunk of seen) {
				MutableHashMap.set(explored, chunkKey(chunk.cx, chunk.cz), chunk.bits)
				stamp(exploredData, fogCorner, chunk.cx, chunk.cz, chunk.bits)
			}
			if (Array.isReadonlyArrayNonEmpty(seen)) {
				reach(exploredData, knownData)
				knownTexture.needsUpdate = true
			}
		},
		// The place and half-height that frame a set of points on screen, with a margin, as the camera faces now: always farther out than the player zooms, at most the overview's.
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
					{maximum: ZOOM.overview, minimum: ZOOM.farthest}
				)
			}
		},
		// The followed unit's model, edged in its team's colour.
		focus(object: Option.Option<THREE.Object3D>, color: string) {
			outline.visibleEdgeColor.set(color)
			outline.selectedObjects = Option.toArray(object)
			outline.enabled = Option.isSome(object)
		},
		// The fog over the unexplored, or none and the teams' zones instead.
		fog(on: boolean) {
			fogOn.value = 0
			if (on) fogOn.value = 1
		},
		ground(x: number, z: number) {
			return Option.getOrElse(
				Option.map(heightAt(x, z), height => height.ground),
				() => view.target.y
			)
		},
		heightAt,
		// Asks what lies on the tile under the pointer; the answer reaches `onInspected`, unless a newer ask overtakes it.
		inspect(clientX: number, clientY: number) {
			const hit = groundUnder(clientX, clientY)
			inspection.ask += 1
			Option.match(hit, {
				onNone: () => undefined,
				onSome: at => {
					// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker's postMessage takes no target origin.
					builders[0]?.worker.postMessage({_tag: 'Inspect', ask: inspection.ask, ...at})
				}
			})
			return hit
		},
		// The ground the view's middle looks at.
		looking() {
			return {x: view.target.x, z: view.target.z}
		},
		// Runs once the camera has moved each frame, for what sits on screen over the world.
		onDrawn(listener: () => void) {
			listeners.drawn = [...listeners.drawn, listener]
		},
		// Runs before the camera moves each frame, for what it follows.
		onFrame(listener: (seconds: number, delta: number) => void) {
			listeners.all = [...listeners.all, listener]
		},
		onInspected(listener: (answer: Inspected) => void) {
			inspection.listeners = [...inspection.listeners, listener]
		},
		// Drags the view by screen pixels: the ground under the pointer follows it.
		pan(dx: number, dy: number) {
			const perPixel = (view.zoom * 2) / Number.max(1, view.size.height)
			const right = new THREE.Vector3().crossVectors(UP, direction).normalize()
			const forward = new THREE.Vector3(-direction.x, 0, -direction.z).normalize()
			glide.offset.addScaledVector(right, -dx * perPixel)
			glide.offset.addScaledVector(forward, (dy * perPixel) / Math.sin(ELEVATION))
		},
		// Whether the view is dragged off its subject.
		panned() {
			return glide.offset.lengthSq() > 1e-6
		},
		project(x: number, y: number, z: number) {
			const point = new THREE.Vector3(x, y, z).project(camera)
			return {x: ((point.x + 1) / 2) * view.size.width, y: ((1 - point.y) / 2) * view.size.height}
		},
		// The world as generated again, for a stream that starts over: no chunk, explored tile, change or cleared prop kept.
		reset() {
			view.epoch += 1
			tell({_tag: 'Reset'})
			MutableHashMap.forEach(chunks, loaded => disposeGroup(loaded.group))
			MutableHashMap.clear(chunks)
			MutableHashMap.clear(explored)
			exploredData.set(new Uint8Array(exploredData.length))
			reach(exploredData, knownData)
			knownTexture.needsUpdate = true
			groundData.set(unbuilt)
			groundTexture.needsUpdate = true
			zoneData.set(new Uint8Array(zoneData.length))
			zoneTexture.needsUpdate = true
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
				sights.uSights.value[entry.index]?.set(entry.disc.x, entry.disc.z, entry.disc.radius, 0)
			}
			sights.uSightCount.value = shown.length
		},
		size() {
			return view.size
		},
		// Half the view's height in tiles: how far out the camera is.
		span() {
			return view.zoom
		},
		turn(quarters: number) {
			view.quarter += quarters
		},
		// Each chunk a team stood in, in the colours of the teams that did.
		zones(zones: NonNullable<Frame['zones']>, colors: string[]) {
			zoneData.set(new Uint8Array(zoneData.length))
			const color = new THREE.Color()
			for (const zone of zones) {
				const x = zone.cx + ZONES / 2
				const z = zone.cz + ZONES / 2
				const mixed = Array.filter(colors, (_, team) => ((zone.teams >> team) & 1) === 1)
				if (x >= 0 && z >= 0 && x < ZONES && z < ZONES && Array.isArrayNonEmpty(mixed)) {
					const sum = Array.reduce(mixed, {b: 0, g: 0, r: 0}, (total, entry) => {
						color.set(entry)
						return {b: total.b + color.b, g: total.g + color.g, r: total.r + color.r}
					})
					color.setRGB(sum.r / mixed.length, sum.g / mixed.length, sum.b / mixed.length)
					zoneData.set(
						[Number.round(color.r * 255, 0), Number.round(color.g * 255, 0), Number.round(color.b * 255, 0), 255],
						(z * ZONES + x) * 4
					)
				}
			}
			zoneTexture.needsUpdate = true
		},
		// Zooms the view by a factor: the zoom the player keeps, or a framed subject's for as long as it is framed.
		zoomBy(factor: number) {
			Option.match(glide.aim.zoom, {
				onNone: () => {
					glide.zoom.follow = Number.clamp(glide.zoom.follow * factor, {maximum: ZOOM.farthest, minimum: ZOOM.nearest})
				},
				onSome: framed => {
					glide.zoom.framed = Number.clamp(glide.zoom.framed * factor, {
						maximum: ZOOM.overview / framed,
						minimum: ZOOM.nearest / framed
					})
				}
			})
		}
	}
}

export type Renderer = ReturnType<typeof createRenderer>
