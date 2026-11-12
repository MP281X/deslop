import {RegistryContext} from '@effect/atom-react'
import {assert, beforeAll, it} from '@effect/vitest'

import {Array, Cause, Effect, Option, String} from 'effect'

import {RouterProvider, createMemoryHistory, createRouter} from '@tanstack/react-router'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'

import {AuthError} from '@deslop/runtime/shared/auth'

import {routeTree} from '#routeTree.gen.ts'

import {overviewAtom, traceAtom} from '#lib/utils.ts'
import {Route} from '#routes/(home)/index.tsx'
import {traceView} from '#services/telemetry/lib/utils.ts'
import {Entry, TelemetryError} from '#services/telemetry/schema.ts'
import type {Overview, Range, Trace} from '#services/telemetry/schema.ts'

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const RANGE: Range = '1h'
beforeAll(() => Route.options.component?.preload?.())
const trace = traceView(
	[
		Entry.make({
			denied: false,
			durationMs: 10,
			id: 'private-span',
			name: 'Private retained span',
			payload: {},
			receivedAt: 1_781_870_000_000,
			resource: {},
			service: '@deslop/deploy-server',
			signal: 'trace',
			spanId: 'aaaaaaaaaaaaaaaa',
			status: 0,
			time: '1781870000000000000',
			traceId: ID
		})
	],
	ID
)

function render(
	result: AsyncResult.AsyncResult<Trace, AuthError | TelemetryError>,
	overview?: AsyncResult.AsyncResult<Overview, AuthError | TelemetryError>,
	path = '/',
	traceId = ID
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const registry = yield* Effect.acquireRelease(
				Effect.sync(() =>
					AtomRegistry.make({
						initialValues: [
							[
								overviewAtom(RANGE),
								overview ??
									AsyncResult.success({
										apps: [
											{
												name: 'deploy',
												operations: [
													{
														count: 1,
														failures: 0,
														name: 'Inventory.snapshot',
														p50Ms: 10,
														p95Ms: 10,
														runtime: 'server',
														traces: [{durationMs: 10, id: ID, time: '1781870000000000000'}]
													}
												]
											}
										]
									}),
								{skipInitialRun: true}
							],
							[traceAtom(RANGE, traceId), result, {skipInitialRun: true}]
						]
					})
				),
				value => Effect.sync(() => value.dispose())
			)
			registry.get(traceAtom(RANGE, traceId))
			registry.ensureNode(traceAtom(RANGE, traceId)).setInitialValue(result)
			if (overview !== undefined) registry.ensureNode(overviewAtom(RANGE)).setInitialValue(overview)
			const router = createRouter({history: createMemoryHistory({initialEntries: [path]}), routeTree})
			yield* Effect.promise(() => router.load())
			return renderToString(
				createElement(RegistryContext.Provider, {value: registry}, createElement(RouterProvider, {router}))
			)
		})
	)
}

it.effect(
	'keeps retained spans and explains a failed trace refresh',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.failWithPrevious(TelemetryError.make({message: 'Trace unavailable'}), {
				previous: Option.some(AsyncResult.success(trace))
			})
		)
		assert.include(html, 'Private retained span')
		assert.include(html, 'aria-label="Out of date"')
		assert.notInclude(html, 'Trace out of date')
		assert.notInclude(html, 'Operations out of date')
		assert.notInclude(html, 'Trace unavailable')
	})
)

it.effect(
	'keeps retained spans after a defect',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.failureWithPrevious(Cause.die('Decode failed'), {previous: Option.some(AsyncResult.success(trace))})
		)
		assert.include(html, 'Private retained span')
		assert.include(html, 'aria-label="Out of date"')
		assert.notInclude(html, 'Trace out of date')
		assert.notInclude(html, 'Operations out of date')
		assert.notInclude(html, 'Decode failed')
	})
)

it.effect(
	'owns a trace failure without retained data',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.fail(TelemetryError.make({message: 'No trace remains'})))
		assert.include(html, 'Can’t load this view')
		assert.notInclude(html, 'No trace remains')
		assert.notInclude(html, 'Private retained span')
	})
)

it.effect(
	'hides retained spans through an authorization failure and its retry',
	Effect.fnUntraced(function* () {
		for (const waiting of [false, true]) {
			const html = yield* render(
				AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Access denied'}), {
					previous: Option.some(AsyncResult.success(trace)),
					waiting
				})
			)
			assert.include(html, 'Access denied')
			assert.notInclude(html, 'Private retained span')
		}
	})
)

it.effect(
	'keeps initial trace loading inside the spans boundary',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial())
		assert.include(html, 'aria-label="Spans"')
		assert.notInclude(html, '>Timeline<')
		assert.notInclude(html, 'Something went wrong')
	})
)

it.effect(
	'keeps the pane shell outside initial overview suspension without redundant column labels',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.initial())
		for (const heading of ['Operations', 'Trace']) {
			assert.include(html, heading)
		}
		for (const heading of ['Age', 'Failure', 'Duration', 'Span', 'Timeline', 'Failed', 'Runs', 'Typical']) {
			assert.notInclude(html, `>${heading}<`)
		}
		assert.include(html, 'aria-busy="true"')
		assert.notInclude(html, 'Select an operation')
		assert.notInclude(html, 'Select a trace')
	})
)

it.effect(
	'replaces loading rows with honest empty panes',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.success({apps: []}))
		for (const label of ['No traces in this frame', 'Select an operation', 'Select a trace']) {
			assert.include(html, `aria-label="${label}"`)
			assert.notInclude(html, `>${label}<`)
		}
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'marks the selected rows with the stock row surface and edge-to-edge dividers',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.success(trace))
		assert.include(html, 'data-selected="true"')
		assert.match(html, /aria-current="true"/u)
		assert.notInclude(html, 'animate-grow-in')
		assert.notInclude(html, 'grid-rows-single')
	})
)

it.effect(
	'owns an initial overview defect instead of leaving its skeleton indefinitely',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.failure(Cause.die('Overview decode failed')))
		assert.include(html, 'Can’t load this view')
		assert.notInclude(html, 'Overview decode failed')
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'centres an icon in an authorised empty waterfall without loading or explanatory copy',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.success(traceView([], ID)))
		assert.include(html, 'aria-label="No spans"')
		assert.notInclude(html, '>No spans<')
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'keeps unbroken attribute keys and values whole on a one-line detail row',
	Effect.fnUntraced(function* () {
		const key = String.repeat(240)('k')
		const html = yield* render(
			AsyncResult.success({
				...trace,
				spans: Array.map(trace.spans, span => ({
					...span,
					payload: {...span.payload, attributes: [{key, value: {stringValue: String.repeat(4000)('v')}}]}
				}))
			})
		)
		assert.include(html, `title="${key}"`)
		assert.include(html, String.repeat(4000)('v'))
	})
)

it.effect(
	'lists the chosen app’s operations, failing first, with a side glyph only for a shared name',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.success(trace),
			AsyncResult.success({
				apps: [
					{
						name: 'deploy',
						operations: [
							{
								count: 99,
								failures: 0,
								name: 'deploy.idle',
								p50Ms: 4,
								p95Ms: 4,
								runtime: 'server',
								traces: [{durationMs: 10, id: ID, time: '1781870000000000000'}]
							}
						]
					},
					{
						name: 'gateway',
						operations: [
							{
								count: 9,
								failures: 0,
								name: 'gateway.idle',
								p50Ms: 40,
								p95Ms: 40,
								runtime: 'server',
								traces: [{durationMs: 10, id: ID, time: '1781860000000000000'}]
							},
							{
								count: 2,
								failures: 3,
								name: 'gateway.fail',
								p50Ms: 12,
								p95Ms: 12,
								runtime: 'server',
								traces: [{durationMs: 10, id: ID, time: '1781850000000000000'}]
							}
						]
					},
					{
						name: 'stash',
						operations: [
							{
								count: 5,
								failures: 0,
								name: 'notes.search',
								p50Ms: 48,
								p95Ms: 48,
								runtime: 'server',
								traces: [{durationMs: 10, id: ID, time: '1781840000000000000'}]
							},
							{
								count: 3,
								failures: 0,
								name: 'notes.search',
								p50Ms: 60,
								p95Ms: 60,
								runtime: 'web',
								traces: [{durationMs: 10, id: ID, time: '1781830000000000000'}]
							}
						]
					}
				]
			}),
			'/?source=stash'
		)
		assert.notInclude(html, '>deploy.idle<')
		assert.notInclude(html, '>gateway.idle<')
		assert.notInclude(html, '>gateway.fail<')
		assert.isBelow(
			Option.getOrThrow(String.indexOf('aria-label="notes.search, server')(html)),
			Option.getOrThrow(String.indexOf('aria-label="notes.search, web')(html))
		)
		assert.include(html, 'aria-label="deploy"')
		assert.include(html, 'aria-label="stash"')
		assert.include(html, 'aria-label="notes.search, server')
		assert.include(html, 'aria-label="notes.search, web')
		assert.notInclude(html, 'aria-label="stash notes.search')
	})
)

it.effect(
	'narrows the operations list and its first selection to the URL’s app filter',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.success(trace),
			AsyncResult.success({
				apps: [
					{
						name: 'deploy',
						operations: [
							{
								count: 1,
								failures: 0,
								name: 'deploy.only',
								p50Ms: 4,
								p95Ms: 4,
								runtime: 'server',
								traces: [{durationMs: 10, id: ID, time: '1781870000000000000'}]
							}
						]
					},
					{
						name: 'stash',
						operations: [
							{
								count: 1,
								failures: 0,
								name: 'stash.only',
								p50Ms: 4,
								p95Ms: 4,
								runtime: 'server',
								traces: [{durationMs: 10, id: ID, time: '1781860000000000000'}]
							}
						]
					}
				]
			}),
			'/?source=stash'
		)
		assert.notInclude(html, '>deploy.only<')
		assert.include(html, '>stash.only<')
		assert.include(html, 'aria-label="stash"')
	})
)

it.effect(
	'opens the app with the newest failed trace, else the first tab',
	Effect.fnUntraced(function* () {
		const failing = yield* render(
			AsyncResult.success(trace),
			AsyncResult.success({
				apps: [
					{
						name: 'stash',
						operations: [
							{
								count: 1,
								failures: 0,
								name: 'stash.only',
								p50Ms: 1,
								p95Ms: 1,
								runtime: 'server',
								traces: [{durationMs: 1, id: ID, time: '1781840000000000000'}]
							}
						]
					},
					{
						name: 'deploy',
						operations: [
							{
								count: 1,
								failures: 1,
								name: 'deploy.only',
								p50Ms: 1,
								p95Ms: 1,
								runtime: 'server',
								traces: [{durationMs: 1, failure: {span: 'run'}, id: ID, time: '1781850000000000000'}]
							}
						]
					},
					{
						name: 'gateway',
						operations: [
							{
								count: 1,
								failures: 1,
								name: 'gateway.only',
								p50Ms: 1,
								p95Ms: 1,
								runtime: 'server',
								traces: [{durationMs: 1, failure: {span: 'run'}, id: ID, time: '1781860000000000000'}]
							}
						]
					}
				]
			})
		)
		assert.include(failing, '>gateway.only<')
		assert.notInclude(failing, '>stash.only<')
		assert.notInclude(failing, '>deploy.only<')
		const quiet = yield* render(
			AsyncResult.success(trace),
			AsyncResult.success({
				apps: [
					{
						name: 'stash',
						operations: [
							{
								count: 1,
								failures: 0,
								name: 'stash.only',
								p50Ms: 1,
								p95Ms: 1,
								runtime: 'server',
								traces: [{durationMs: 1, id: ID, time: '1781840000000000000'}]
							}
						]
					},
					{
						name: 'deploy',
						operations: [
							{
								count: 1,
								failures: 0,
								name: 'deploy.only',
								p50Ms: 1,
								p95Ms: 1,
								runtime: 'server',
								traces: [{durationMs: 1, id: ID, time: '1781850000000000000'}]
							}
						]
					}
				]
			})
		)
		assert.include(quiet, '>stash.only<')
		assert.notInclude(quiet, '>deploy.only<')
	})
)

it.effect(
	'shows the picked span’s identity even when it has no detail rows',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.success(trace),
			undefined,
			`/?source=deploy&operation=Inventory.snapshot&side=server&pane=Trace&trace=${ID}&span=aaaaaaaaaaaaaaaa`
		)
		assert.include(html, 'aria-label="Span details"')
		assert.include(html, 'deploy · at 0 ms')
		assert.include(html, 'Private retained span')
	})
)

it.effect(
	'marks a failed trace in its row and hover name without repeating the diagnostic as visible text',
	Effect.fnUntraced(function* () {
		const html = yield* render(
			AsyncResult.success(trace),
			AsyncResult.success({
				apps: [
					{
						name: 'deploy',
						operations: [
							{
								count: 1,
								failures: 1,
								name: 'Inventory.snapshot',
								p50Ms: 10,
								p95Ms: 10,
								runtime: 'server',
								traces: [{durationMs: 10, failure: {span: 'Parser.decode'}, id: ID, time: '1781870000000000000'}]
							}
						]
					}
				]
			})
		)
		assert.include(html, 'aria-label="Failed in Parser.decode"')
		assert.include(html, 'title="Failed in Parser.decode"')
		assert.strictEqual(Array.length(String.split('Failed in Parser.decode')(html)) - 1, 2)
		assert.notInclude(html, '>Failed in Parser.decode<')
	})
)
