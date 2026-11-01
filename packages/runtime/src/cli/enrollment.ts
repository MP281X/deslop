import {Array, Effect, Schedule, Stream, Stdio, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'

import {Enrollment} from '#auth/schema.ts'
import type {AppSettings} from '#cli/schema.ts'
import {AppError} from '#cli/schema.ts'

export const enroll = Effect.fnUntraced(function* (name: string, config: AppSettings) {
	if (config.auth === '') return
	const issuer = yield* Effect.try({
		catch: cause => AppError.make({cause, message: 'Invalid authorization server URL'}),
		try: () => new URL(config.auth)
	})
	if (issuer.protocol !== 'https:' && !Array.contains(['localhost', '127.0.0.1', '[::1]'], issuer.hostname)) {
		return yield* AppError.make({message: 'Authorization servers must use HTTPS'})
	}
	const resource = yield* Effect.try({
		catch: cause => AppError.make({cause, message: 'Invalid public app URL'}),
		try: () => new URL(config.url)
	})
	if (resource.protocol !== 'https:') {
		return yield* AppError.make({message: 'With --auth, set --url to the app’s canonical HTTPS URL'})
	}
	const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
	const request = yield* pipe(
		HttpClientRequest.post(new URL('/api/resources', issuer).href),
		HttpClientRequest.bodyJson({name, resource: config.url})
	)
	const registration = yield* pipe(
		client.execute(request),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Enrollment))
	)
	if (registration.status === 'approved') return
	if (registration.status === 'denied') {
		return yield* AppError.make({message: 'An admin denied this resource registration'})
	}
	const stdio = yield* Stdio.Stdio
	yield* Stream.run(
		Stream.make(`Approve ${config.url} as an admin at ${new URL('/resources', issuer).href}\n`),
		stdio.stderr()
	)
	const approved = yield* pipe(
		client.get(new URL(`/api/resources/${registration.id}`, issuer).href),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Enrollment)),
		Effect.repeat({schedule: Schedule.spaced('2 seconds'), while: row => row.status === 'pending'}),
		Effect.timeout('10 minutes')
	)
	if (approved.status !== 'approved') {
		return yield* AppError.make({message: 'An admin denied this resource registration'})
	}
})
