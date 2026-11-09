import {RegistryContext} from '@effect/atom-react'
import {assert, beforeAll, it} from '@effect/vitest'

import {Array, Cause, Effect, Option, String} from 'effect'

import {RouterProvider, createMemoryHistory, createRouter} from '@tanstack/react-router'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'

import {AuthError} from '@deslop/runtime/auth/schema'

import {routeTree} from '#routeTree.gen.ts'

import {overviewAtom, traceAtom} from '#lib/utils.ts'
import {Route} from '#routes/(home)/index.tsx'
import {traceView} from '#services/telemetry/lib/utils.ts'
import {Entry, TelemetryError} from '#services/telemetry/schema.ts'
import type {Overview, Trace} from '#services/telemetry/schema.ts'

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
beforeAll(() => Route.options.component?.preload?.())
const trace = traceView(
	[
		Entry.make({
			durationMs: 10,
			id: 'private-span',
			name: 'Private retained span',
			payload: {},
			resource: {},
			resourceSchemaUrl: '',
			scope: {},
			scopeSchemaUrl: '',
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
	overview?: AsyncResult.AsyncResult<Overview, AuthError | TelemetryError>
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const registry = yield* Effect.acquireRelease(
				Effect.sync(() =>
					AtomRegistry.make({
						initialValues: [
							[
								overviewAtom,
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
														runtime: 'server',
														traces: [{durationMs: 10, id: ID, time: '1781870000000000000'}]
													}
												]
											}
										]
									}),
								{skipInitialRun: true}
							],
							[traceAtom(ID), result, {skipInitialRun: true}]
						]
					})
				),
				value => Effect.sync(() => value.dispose())
			)
			registry.get(traceAtom(ID))
			registry.ensureNode(traceAtom(ID)).setInitialValue(result)
			if (overview !== undefined) registry.ensureNode(overviewAtom).setInitialValue(overview)
			const router = createRouter({history: createMemoryHistory(), routeTree})
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
		assert.include(html, 'aria-label="Trace out of date"')
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
		assert.include(html, 'aria-label="Trace out of date"')
		assert.notInclude(html, 'Decode failed')
	})
)

it.effect(
	'owns a trace failure without retained data',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.fail(TelemetryError.make({message: 'No trace remains'})))
		assert.include(html, 'Can’t load this view')
		assert.include(html, 'Retry')
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
		assert.include(html, 'grid-cols-scope')
		assert.include(html, 'aria-busy="true"')
		assert.notInclude(html, 'Select an operation')
		assert.notInclude(html, 'Select a trace')
	})
)

it.effect(
	'replaces loading rows with honest empty panes',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.success({apps: []}))
		for (const label of ['No traces yet', 'Select an operation', 'Select a trace']) {
			assert.include(html, `aria-label="${label}"`)
			assert.notInclude(html, `>${label}<`)
		}
		assert.notInclude(html, 'aria-busy="true"')
	})
)

it.effect(
	'marks the selected row with independent inset row dividers',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.success(trace))
		assert.include(html, 'class="list-row" data-selected="true"')
		assert.match(html, /aria-current="true" class="[^"]*bg-secondary/u)
		assert.notInclude(html, 'animate-grow-in')
		assert.notInclude(html, 'grid-rows-single')
	})
)

it.effect(
	'owns an initial overview defect instead of leaving its skeleton indefinitely',
	Effect.fnUntraced(function* () {
		const html = yield* render(AsyncResult.initial(), AsyncResult.failure(Cause.die('Overview decode failed')))
		assert.include(html, 'Can’t load this view')
		assert.include(html, 'Retry')
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
	'wraps unbroken attribute keys as well as their values',
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
		assert.include(html, `<dt class="text-muted-foreground wrap-anywhere">${key}</dt>`)
		assert.include(html, String.repeat(4000)('v'))
	})
)

it.effect(
	'marks a failed trace without repeating its diagnostic on the row or its hover name',
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
								runtime: 'server',
								traces: [
									{
										durationMs: 10,
										failure: {message: 'PRIVATE ROW DIAGNOSTIC', span: 'Parser.decode'},
										id: ID,
										time: '1781870000000000000'
									}
								]
							}
						]
					}
				]
			})
		)
		assert.include(html, 'aria-label="Failed in Parser.decode"')
		assert.include(html, 'title="Failed in Parser.decode"')
		assert.notInclude(html, 'PRIVATE ROW DIAGNOSTIC')
	})
)
