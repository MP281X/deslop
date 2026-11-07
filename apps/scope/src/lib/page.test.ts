import {RegistryContext} from '@effect/atom-react'
import {assert, beforeAll, it} from '@effect/vitest'

import {Cause, Option} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import {createElement} from 'react'
import {renderToString} from 'react-dom/server'

import {AuthError} from '@deslop/runtime/auth/schema'

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
	const registry = AtomRegistry.make({
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
	try {
		registry.get(traceAtom(ID))
		registry.ensureNode(traceAtom(ID)).setInitialValue(result)
		if (overview !== undefined) registry.ensureNode(overviewAtom).setInitialValue(overview)
		if (Route.options.component === undefined) throw TelemetryError.make({message: 'Missing Scope page'})
		return renderToString(
			createElement(RegistryContext.Provider, {value: registry}, createElement(Route.options.component))
		)
	} finally {
		registry.dispose()
	}
}

it('keeps retained spans and explains a failed trace refresh', () => {
	const html = render(
		AsyncResult.failWithPrevious(TelemetryError.make({message: 'Trace unavailable'}), {
			previous: Option.some(AsyncResult.success(trace))
		})
	)
	assert.include(html, 'Private retained span')
	assert.include(html, 'aria-label="Trace out of date"')
	assert.notInclude(html, 'Trace unavailable')
})

it('keeps retained spans after a defect', () => {
	const html = render(
		AsyncResult.failureWithPrevious(Cause.die('Decode failed'), {previous: Option.some(AsyncResult.success(trace))})
	)
	assert.include(html, 'Private retained span')
	assert.include(html, 'aria-label="Trace out of date"')
	assert.notInclude(html, 'Decode failed')
})

it('owns a trace failure without retained data', () => {
	const html = render(AsyncResult.fail(TelemetryError.make({message: 'No trace remains'})))
	assert.include(html, 'aria-label="Unavailable"')
	assert.notInclude(html, 'No trace remains')
	assert.notInclude(html, 'Private retained span')
})

it('hides retained spans through an authorization failure and its retry', () => {
	for (const waiting of [false, true]) {
		const html = render(
			AsyncResult.failWithPrevious(AuthError.make({error: 'access_denied', message: 'Access denied'}), {
				previous: Option.some(AsyncResult.success(trace)),
				waiting
			})
		)
		assert.include(html, 'Access denied')
		assert.notInclude(html, 'Private retained span')
	}
})

it('keeps initial trace loading inside the spans boundary', () => {
	const html = render(AsyncResult.initial())
	assert.include(html, 'aria-label="Spans"')
	assert.include(html, 'Timeline')
	assert.notInclude(html, 'Something went wrong')
})

it('keeps the pane shell outside initial overview suspension without redundant column labels', () => {
	const html = render(AsyncResult.initial(), AsyncResult.initial())
	for (const heading of ['Operations', 'Age', 'Trace', 'Failure', 'Span', 'Timeline']) {
		assert.include(html, heading)
	}
	for (const heading of ['Failed', 'Runs', 'Typical']) assert.notInclude(html, `>${heading}<`)
	assert.include(html, 'grid-cols-scope')
	assert.include(html, 'aria-busy="true"')
	assert.notInclude(html, 'Select an operation')
	assert.notInclude(html, 'Select a trace')
})

it('replaces loading rows with honest empty panes', () => {
	const html = render(AsyncResult.initial(), AsyncResult.success({apps: []}))
	assert.include(html, 'No traces yet')
	assert.include(html, 'Select an operation')
	assert.include(html, 'Select a trace')
	assert.notInclude(html, 'aria-busy="true"')
})

it('owns an initial overview defect instead of leaving its skeleton indefinitely', () => {
	const html = render(AsyncResult.initial(), AsyncResult.failure(Cause.die('Overview decode failed')))
	assert.include(html, 'aria-label="Unavailable"')
	assert.notInclude(html, 'Overview decode failed')
	assert.notInclude(html, 'aria-busy="true"')
})
