import {RegistryContext} from '@effect/atom-react'
import {assert, beforeAll, it} from '@effect/vitest'

import {Cause, Option} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'

import {AuthError} from '@deslop/runtime/auth/schema'

import {inventoryAtom, metricsAtom} from '#lib/utils.ts'
import {Route} from '#routes/(home)/index.tsx'
import {DeployError, InventoryItem, Snapshot} from '#services/inventory/schema.ts'
import {MachineHistory, Sample} from '#services/metrics/schema.ts'

beforeAll(() => Route.options.component?.preload?.())

const snapshot = Snapshot.make({
	items: [
		InventoryItem.make({
			detail: '',
			id: 'private',
			kind: 'service',
			name: 'deslop-private.service',
			state: 'active',
			url: '',
			worker: 'desktop'
		})
	],
	sources: [{error: '', name: 'desktop'}],
	time: 1,
	workers: ['desktop']
})
const readings = {
	histories: [
		MachineHistory.make({
			error: '',
			samples: [
				Sample.make({
					apps: [{id: 'service:system:deslop-private.service', memory: 1}],
					disks: [],
					memoryTotal: 100,
					memoryUsed: 1,
					swapTotal: 0,
					swapUsed: 0,
					time: 1
				})
			],
			stale: false,
			time: 1,
			worker: 'desktop'
		})
	],
	minutes: 60 as const
}

function render(inventory: Atom.Type<typeof inventoryAtom>, metrics: Atom.Type<typeof metricsAtom>) {
	const registry = AtomRegistry.make({
		initialValues: [
			[inventoryAtom, inventory, {skipInitialRun: true}],
			[metricsAtom, metrics, {skipInitialRun: true}]
		]
	})
	try {
		registry.get(inventoryAtom)
		registry.get(metricsAtom)
		registry.ensureNode(inventoryAtom).setInitialValue(inventory)
		registry.ensureNode(metricsAtom).setInitialValue(metrics)
		if (Route.options.component === undefined) throw DeployError.make({message: 'Missing Deploy page'})
		return renderToString(
			createElement(RegistryContext.Provider, {value: registry}, createElement(Route.options.component))
		)
	} finally {
		registry.dispose()
	}
}

it('keeps real pane headings outside initial suspension', () => {
	const html = render(AsyncResult.initial(), AsyncResult.initial())
	for (const heading of ['Apps', 'Processes', 'Machine']) assert.include(html, `>${heading}<`)
	assert.include(html, 'aria-label="Usage history"')
	assert.include(html, 'aria-busy="true"')
	assert.notInclude(html, 'No apps in this range')
	assert.notInclude(html, 'No machine')
})

it('replaces an empty authorized history with an empty state, not another skeleton', () => {
	const html = render(AsyncResult.success(snapshot), AsyncResult.success({histories: [], minutes: 60}))
	assert.include(html, 'Open private')
	assert.include(html, 'No readings in this range')
	assert.notInclude(html, 'aria-busy="true"')
})

it('shows usable charts while the independent inventory reader is still pending', () => {
	const html = render(AsyncResult.initial(), AsyncResult.success(readings))
	assert.include(html, 'Memory')
	assert.include(html, 'CPU')
	assert.include(html, 'aria-label="Apps"')
	assert.notInclude(html, 'aria-label="Usage history"')
})

it('owns an initial inventory defect without hiding the machine charts', () => {
	const html = render(AsyncResult.failure(Cause.die('Inventory decode failed')), AsyncResult.success(readings))
	assert.include(html, 'Inventory decode failed')
	assert.include(html, 'Try again')
	assert.include(html, 'Memory')
	assert.include(html, 'CPU')
	assert.notInclude(html, 'aria-busy="true"')
})

it('owns an initial history failure without hiding apps or leaving a chart skeleton', () => {
	const html = render(
		AsyncResult.success(snapshot),
		AsyncResult.fail(DeployError.make({message: 'History unavailable'}))
	)
	assert.include(html, 'Open private')
	assert.include(html, 'History unavailable')
	assert.include(html, 'Try again')
	assert.notInclude(html, 'aria-busy="true"')
})

it('keeps useful inventory and readings through ordinary defects', () => {
	const html = render(
		AsyncResult.failureWithPrevious(Cause.die('Inventory decode failed'), {
			previous: Option.some(AsyncResult.success(snapshot))
		}),
		AsyncResult.failureWithPrevious(Cause.die('History decode failed'), {
			previous: Option.some(AsyncResult.success(readings))
		})
	)
	assert.include(html, 'Open private')
	assert.include(html, 'Memory')
	assert.include(html, 'Inventory decode failed')
	assert.include(html, 'History decode failed')
	assert.notInclude(html, 'aria-busy="true"')
})

it('keeps authorization failures above every pane even when another read succeeded', () => {
	const html = render(
		AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Access denied'}), {
			previous: Option.some(AsyncResult.success(snapshot))
		}),
		AsyncResult.success(readings)
	)
	assert.include(html, 'Access denied')
	assert.notInclude(html, 'Open private')
	assert.notInclude(html, '>Memory<')
})
