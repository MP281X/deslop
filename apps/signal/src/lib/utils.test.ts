import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {
	EMPTY,
	configurationAtom,
	cursorAtom,
	hudAtom,
	loadingAtom,
	runStateAtom,
	sourceAtom,
	viewAtom
} from '#lib/utils.ts'
import {GameError} from '#services/game/schema.ts'

const LOADED = {...EMPTY, count: 1, frame: {...EMPTY.frame, tick: 7743}}

it('keeps disabled local inference visible in a running physics world and clears notices only when configured', () => {
	const registry = AtomRegistry.make({
		initialValues: [
			[
				runStateAtom,
				AsyncResult.success({coreConfigured: true, localDecisions: false, running: true}),
				{skipInitialRun: true}
			]
		]
	})
	try {
		registry.mount(configurationAtom)
		assert.deepStrictEqual(registry.get(configurationAtom), [
			'Local decisions off · Individuals cannot request model decisions'
		])
		registry
			.ensureNode(runStateAtom)
			.setInitialValue(AsyncResult.success({coreConfigured: false, localDecisions: false, running: false}))
		assert.deepStrictEqual(registry.get(configurationAtom), [
			'Model key missing · Agent decisions unavailable',
			'Local decisions off · Individuals cannot request model decisions'
		])
		registry
			.ensureNode(runStateAtom)
			.setInitialValue(AsyncResult.success({coreConfigured: true, localDecisions: true, running: false}))
		assert.deepStrictEqual(registry.get(configurationAtom), [])
	} finally {
		registry.dispose()
	}
})

it('retains the displayed world while a historical source connects', () => {
	const registry = AtomRegistry.make({initialValues: [[viewAtom, AsyncResult.success(LOADED), {skipInitialRun: true}]]})
	try {
		registry.mount(hudAtom)
		assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(hudAtom))), LOADED)
		registry.ensureNode(viewAtom).setInitialValue(AsyncResult.initial())
		registry.set(sourceAtom, Option.some({from: 1200, speed: 0}))
		assert.isTrue(registry.get(loadingAtom))
		assert.strictEqual(registry.get(cursorAtom), 1200)
		assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(hudAtom))), LOADED)
		registry.ensureNode(viewAtom).setInitialValue(AsyncResult.success(EMPTY))
		assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(hudAtom))), LOADED)
		registry.set(sourceAtom, Option.none())
		assert.strictEqual(registry.get(cursorAtom), 7743)
	} finally {
		registry.dispose()
	}
})

it('preserves connection failures and replaces the retained world with the requested history', () => {
	const registry = AtomRegistry.make({initialValues: [[viewAtom, AsyncResult.success(LOADED), {skipInitialRun: true}]]})
	try {
		registry.mount(hudAtom)
		registry.get(hudAtom)
		registry.ensureNode(viewAtom).setInitialValue(AsyncResult.fail(GameError.make({message: 'offline'})))
		assert.isTrue(AsyncResult.isFailure(registry.get(hudAtom)))
		assert.strictEqual(Option.getOrThrow(AsyncResult.error(registry.get(hudAtom))).message, 'offline')
		assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(hudAtom))), LOADED)
		const historical = {...LOADED, frame: {...LOADED.frame, tick: 1200}}
		registry.ensureNode(viewAtom).setInitialValue(AsyncResult.success(historical))
		assert.isFalse(registry.get(loadingAtom))
		assert.strictEqual(Option.getOrThrow(AsyncResult.value(registry.get(hudAtom))), historical)
	} finally {
		registry.dispose()
	}
})

it('does not present an empty initial stream as a previously recorded world', () => {
	const registry = AtomRegistry.make({initialValues: [[viewAtom, AsyncResult.success(EMPTY), {skipInitialRun: true}]]})
	try {
		registry.mount(hudAtom)
		registry.get(hudAtom)
		registry.ensureNode(viewAtom).setInitialValue(AsyncResult.initial())
		assert.isTrue(AsyncResult.isInitial(registry.get(hudAtom)))
		assert.isTrue(registry.get(loadingAtom))
	} finally {
		registry.dispose()
	}
})
