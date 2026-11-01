import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import * as THREE from 'three'

import {disposeSurveyCore, surveyCore} from './-survey-core.ts'

it('keeps the Survey Core inside its reserved footprint and applies a real team material', () => {
	const team = new THREE.MeshBasicMaterial({color: '#5b8def'})
	const ghost = new THREE.MeshBasicMaterial()
	const model = surveyCore(team, ghost, false)
	const bounds = new THREE.Box3().setFromObject(model)
	assert.isAbove(bounds.max.y, 4)
	assert.isBelow(bounds.max.y, 6)
	assert.isBelow(bounds.max.x, 2.5)
	assert.isAbove(bounds.min.x, -2.5)
	assert.isTrue(Array.some(model.children, child => child instanceof THREE.Mesh && child.material === team))
	model.traverse(child => {
		if (child instanceof THREE.Mesh) child.geometry.dispose()
	})
	disposeSurveyCore(model)
	team.dispose()
	ghost.dispose()
})
