import {RegistryContext} from '@effect/atom-react'
import {assert, beforeAll, it} from '@effect/vitest'

import {Cause, Effect, Option} from 'effect'

import {RouterProvider, createMemoryHistory, createRouter} from '@tanstack/react-router'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'

import {AuthError} from '@deslop/runtime/auth/schema'

import {routeTree} from '#routeTree.gen.ts'

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
const readings = [
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
]

function render(inventory: Atom.Type<typeof inventoryAtom>, metrics: Atom.Type<ReturnType<typeof metricsAtom>>) {
	return Effect.scoped(
		Effect.gen(function* () {
			const registry = yield* Effect.acquireRelease(
				Effect.sync(() =>
					AtomRegistry.make({
						initialValues: [
							[inventoryAtom, inventory, {skipInitialRun: true}],
							[metricsAtom(60), metrics, {skipInitialRun: true}]
						]
					})
				),
				value => Effect.sync(() => value.dispose())
			)
			registry.get(inventoryAtom)
			registry.get(metricsAtom(60))
			registry.ensureNode(inventoryAtom).setInitialValue(inventory)
			registry.ensureNode(metricsAtom(60)).setInitialValue(metrics)
			const router = createRouter({history: createMemoryHistory(), routeTree})
			yield* Effect.promise(() => router.load())
			return renderToString(
				createElement(RegistryContext.Provider, {value: registry}, createElement(RouterProvider, {router}))
			)
		})
	)
}

it.effect(
	'keeps the bar, tabs and axis real outside initial suspension',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.initial())
		assert.include(html, 'aria-label="History range"')
		assert.include(html, 'aria-label="Metric"')
		assert.include(html, 'aria-label="Usage history"')
		assert.include(html, 'aria-label="Apps loading"')
		assert.include(html, 'aria-label="Select an app"')
		assert.include(html, 'aria-busy="true"')
		assert.notInclude(html, 'No apps in this range')
	})
)

it.effect(
	'replaces an empty authorized history with an empty state, not another skeleton',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.success(snapshot), AsyncResult.success([]))
		assert.include(html, 'Open private')
		assert.include(html, 'No readings in this range')
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'shows the chart while the independent inventory reader is still pending',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.success(readings))
		assert.include(html, 'Memory over time')
		assert.include(html, 'aria-label="Apps loading"')
		assert.include(html, 'aria-label="Metric"')
		assert.notInclude(html, 'aria-label="Usage history"')
	})
)

it.effect(
	'owns an initial inventory defect without hiding the machine chart',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.failure(Cause.die('Inventory decode failed')), AsyncResult.success(readings))
		assert.include(html, 'Can’t load this view')
		assert.notInclude(html, 'Inventory decode failed')
		assert.include(html, 'Memory over time')
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'owns an initial history failure without hiding apps or leaving a chart skeleton',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.success(snapshot),
			AsyncResult.fail(DeployError.make({message: 'History unavailable'}))
		)
		assert.include(html, 'Open private')
		assert.include(html, 'Can’t load this view')
		assert.notInclude(html, 'History unavailable')
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'keeps useful inventory and readings through ordinary defects',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.failureWithPrevious(Cause.die('Inventory decode failed'), {
				previous: Option.some(AsyncResult.success(snapshot))
			}),
			AsyncResult.failureWithPrevious(Cause.die('History decode failed'), {
				previous: Option.some(AsyncResult.success(readings))
			})
		)
		assert.include(html, 'Open private')
		assert.include(html, 'Memory over time')
		assert.include(html, 'aria-label="Inventory out of date"')
		assert.include(html, 'aria-label="History out of date"')
		assert.notInclude(html, 'Inventory decode failed')
		assert.notInclude(html, 'History decode failed')
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'keeps authorization failures above every pane even when another read succeeded',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Access denied'}), {
				previous: Option.some(AsyncResult.success(snapshot))
			}),
			AsyncResult.success(readings)
		)
		assert.include(html, 'Access denied')
		assert.notInclude(html, 'Open private')
		assert.notInclude(html, 'aria-label="Metric"')
	})
)
