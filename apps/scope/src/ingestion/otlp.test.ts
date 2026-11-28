import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option, Schema} from 'effect'

import {TracesRequest} from './contract.ts'
import {admittedSender, senderOf, spansOf} from './otlp.ts'

const RECEIVED = DateTime.makeUnsafe(3_600_000)

function exported(service: string, spans: readonly unknown[]) {
	return Schema.decodeUnknownSync(TracesRequest)({
		resourceSpans: [
			{resource: {attributes: [{key: 'service.name', value: {stringValue: service}}]}, scopeSpans: [{spans}]}
		]
	})
}

function span(fields: Record<string, unknown>) {
	return {
		endTimeUnixNano: '10000000',
		spanId: '1111111111111111',
		startTimeUnixNano: '0',
		traceId: '1234567890abcdef1234567890abcdef',
		...fields
	}
}

it('names an HTTP server span by its route, and an unrouted one apart from every path', () => {
	const attributes = [{key: 'http.request.method', value: {stringValue: 'GET'}}]
	const rows = spansOf(
		exported('stash-server', [
			span({attributes: [...attributes, {key: 'http.route', value: {stringValue: '/api/notes'}}], name: 'GET'}),
			span({attributes, kind: 2, name: 'GET', spanId: '2222222222222222'})
		]),
		'identified',
		RECEIVED
	)
	assert.deepStrictEqual(
		Array.map(rows.spans, row => row.name),
		['GET /api/notes', 'GET (no route)']
	)
})

it('calls a failed span denied when every exception is an AuthError or the response is a 401', () => {
	const failed = {status: {code: 2}}
	const rows = spansOf(
		exported('stash-server', [
			span({
				...failed,
				events: [
					{
						attributes: [{key: 'exception.type', value: {stringValue: 'AuthError'}}],
						name: 'exception',
						timeUnixNano: '1'
					}
				],
				spanId: '2222222222222222'
			}),
			span({
				...failed,
				attributes: [{key: 'http.response.status_code', value: {intValue: 401}}],
				spanId: '3333333333333333'
			}),
			span({
				...failed,
				events: [
					{attributes: [{key: 'exception.type', value: {stringValue: 'Boom'}}], name: 'exception', timeUnixNano: '1'}
				]
			})
		]),
		'identified',
		RECEIVED
	)
	assert.deepStrictEqual(
		Array.map(rows.spans, row => row.status),
		['denied', 'denied', 'failed']
	)
})

it('admits a repository name only from GitHub, and shows an anonymous ci runtime as unknown', () => {
	const repository = senderOf(
		Option.some({attributes: Option.some([{key: 'service.name', value: {stringValue: 'MP281X/deslop'}}])})
	)
	assert.isTrue(Option.isNone(admittedSender(repository, 'identified')))
	assert.isTrue(Option.isSome(admittedSender(repository, 'github')))
	assert.deepStrictEqual(
		Option.map(admittedSender({...senderOf(Option.none()), runtime: 'ci'}, 'anonymous'), sender => sender.runtime),
		Option.some('unknown')
	)
})
