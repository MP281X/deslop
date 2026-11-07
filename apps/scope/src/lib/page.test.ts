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
import type {Trace} from '#services/telemetry/schema.ts'

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

function render(result: AsyncResult.AsyncResult<Trace, AuthError | TelemetryError>) {
	const registry = AtomRegistry.make({
		initialValues: [
			[
				overviewAtom,
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
	assert.include(html, 'Cannot update this trace')
	assert.include(html, 'Trace unavailable')
	assert.include(html, 'Try again')
})

it('keeps retained spans after a defect', () => {
	const html = render(
		AsyncResult.failureWithPrevious(Cause.die('Decode failed'), {previous: Option.some(AsyncResult.success(trace))})
	)
	assert.include(html, 'Private retained span')
	assert.include(html, 'Decode failed')
})

it('owns a trace failure without retained data', () => {
	const html = render(AsyncResult.fail(TelemetryError.make({message: 'No trace remains'})))
	assert.include(html, 'No trace remains')
	assert.include(html, 'Try again')
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
