import {Array, MutableList} from 'effect'

import * as THREE from 'three'

const PAINTS = new WeakMap<THREE.Object3D, THREE.Material[]>()

export function disposeSurveyCore(object: THREE.Object3D) {
	for (const material of PAINTS.get(object) ?? []) material.dispose()
	PAINTS.delete(object)
}

// The approved Survey Core: faceted receiver, braced feed and compact machinery, centred on its footprint.
export function surveyCore(team: THREE.Material, ghost: THREE.Material, unfinished: boolean) {
	const group = new THREE.Group()
	const body = new THREE.MeshStandardMaterial({color: '#35454f', metalness: 0.45, roughness: 0.55})
	const edge = new THREE.MeshStandardMaterial({color: '#71878c', metalness: 0.35, roughness: 0.6})
	const dark = new THREE.MeshStandardMaterial({color: '#19252a', roughness: 0.8})
	const receiver = new THREE.MeshStandardMaterial({
		color: '#9baead',
		metalness: 0.3,
		roughness: 0.6,
		side: THREE.DoubleSide
	})
	PAINTS.set(group, [body, edge, dark, receiver])
	function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
		const mesh = new THREE.Mesh(geometry, material)
		if (unfinished) mesh.material = ghost
		mesh.position.set(x, y, z)
		group.add(mesh)
		return mesh
	}
	function cylinder(radius: number, top: number, height: number, y: number, material: THREE.Material) {
		return part(new THREE.CylinderGeometry(top, radius, height, 8), material, 0, y + height / 2, 0)
	}
	function beam(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material) {
		const mesh = part(new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 6), material, 0, 0, 0)
		mesh.position.copy(from).add(to).multiplyScalar(0.5)
		mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
	}
	cylinder(1.75, 1.65, 0.16, 0, edge)
	cylinder(1.55, 1.35, 1.05, 0.16, body)
	cylinder(1.35, 1.25, 0.18, 1.21, edge)
	cylinder(0.65, 0.65, 0.25, 1.39, dark)
	for (const side of [-1, 1]) {
		beam(new THREE.Vector3(side * 0.55, 1.64, 0), new THREE.Vector3(side * 0.55, 2.8, 0), 0.13, edge)
	}
	for (const row of Array.range(0, 4)) {
		part(new THREE.BoxGeometry(1.5, 0.055, 0.035), dark, 0, 0.4 + row * 0.13, 1.44)
	}
	part(new THREE.BoxGeometry(1.15, 0.08, 0.04), team, 0, 1.06, 1.45)
	const origin = new THREE.Vector3(0, 2.8, 0)
	const axis = new THREE.Vector3(-0.18, 0.58, 0.8).normalize()
	const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize()
	const v = new THREE.Vector3().crossVectors(axis, u)
	function point(radius: number, angle: number) {
		return origin
			.clone()
			.addScaledVector(u, radius * Math.cos(angle))
			.addScaledVector(v, radius * Math.sin(angle))
			.addScaledVector(axis, 0.24 * radius * radius)
	}
	const vertices = MutableList.make<number>()
	for (const ring of Array.range(0, 3)) {
		for (const segment of Array.range(0, 15)) {
			const angle = (segment * Math.PI) / 8
			const next = ((segment + 1) * Math.PI) / 8
			const a = point(ring * 0.47, angle)
			const b = point((ring + 1) * 0.47, angle)
			const c = point((ring + 1) * 0.47, next)
			const d = point(ring * 0.47, next)
			MutableList.appendAll(vertices, [
				...a.toArray(),
				...b.toArray(),
				...c.toArray(),
				...a.toArray(),
				...c.toArray(),
				...d.toArray()
			])
		}
	}
	const bowl = new THREE.BufferGeometry()
	bowl.setAttribute('position', new THREE.Float32BufferAttribute(MutableList.toArray(vertices), 3))
	bowl.computeVertexNormals()
	part(bowl, receiver, 0, 0, 0)
	const focus = origin.clone().addScaledVector(axis, 1.85)
	for (const segment of Array.range(0, 15)) {
		beam(point(1.88, (segment * Math.PI) / 8), point(1.88, ((segment + 1) * Math.PI) / 8), 0.045, dark)
	}
	for (const spoke of Array.range(0, 2)) beam(point(1.8, (spoke * Math.PI * 2) / 3), focus, 0.035, dark)
	beam(focus.clone().addScaledVector(axis, -0.15), focus.clone().addScaledVector(axis, 0.2), 0.11, body)
	beam(focus.clone().addScaledVector(axis, 0.2), focus.clone().addScaledVector(axis, 0.28), 0.085, team)
	beam(new THREE.Vector3(1.1, 0.5, -0.8), new THREE.Vector3(1.1, 2.5, -0.8), 0.025, edge)
	return group
}
