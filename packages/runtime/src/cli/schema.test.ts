import {assert, it} from '@effect/vitest'

import {Effect, Schema} from 'effect'

import {AppSettings} from '#cli/schema.ts'

it.effect(
	'validates local and Auth-backed settings once at the CLI boundary',
	Effect.fnUntraced(function* () {
		const local = {auth: '', host: '0.0.0.0', port: 5000, traces: '', url: 'http://127.0.0.1:5000'}
		assert.deepStrictEqual(yield* Schema.decodeEffect(AppSettings)(local), local)
		assert.isTrue(
			(yield* Effect.result(
				Schema.decodeEffect(AppSettings)({
					...local,
					auth: 'https://auth.example.com',
					traces: 'https://otel.example.com/otlp',
					url: 'https://scope.example.com'
				})
			))._tag === 'Success'
		)
		for (const invalid of [
			{auth: 'http://auth.example.com', url: 'https://scope.example.com'},
			{auth: 'https://auth.example.com'},
			{url: 'https://user:secret@scope.example.com'},
			{url: 'https://scope.example.com/path'},
			{url: 'not a URL'},
			{port: 0},
			{traces: 'javascript:alert(1)'}
		]) {
			assert.isTrue((yield* Effect.result(Schema.decodeEffect(AppSettings)({...local, ...invalid})))._tag === 'Failure')
		}
	})
)
