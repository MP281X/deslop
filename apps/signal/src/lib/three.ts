import * as THREE from 'three'

// A predicate narrows the mesh's generic geometry; `instanceof` alone leaves it `any` to the type-aware lint.
export function isMesh(node: THREE.Object3D): node is THREE.Mesh {
	return node instanceof THREE.Mesh
}
