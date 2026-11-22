import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {commandLabel} from './command.ts'

it('labels a wrapped command by what it runs, past the wrapper’s flag values and operands', () => {
	assert.deepStrictEqual(commandLabel(['timeout', '5', 'node', 'server.js'], Option.none()).name, 'server.js')
	assert.deepStrictEqual(commandLabel(['sudo', '-u', 'dev', 'node', 'server.js'], Option.none()).name, 'server.js')
	assert.deepStrictEqual(commandLabel(['env', 'PORT=1', 'nice', '-n', '5', 'vite-plus', 'dev'], Option.none()), {
		detail: 'dev',
		name: 'vp'
	})
})

it('masks a credential inside a shell’s command string, quoted or not, as it does in a command’s own arguments', () => {
	const scripts = [
		'curl --header "Authorization: Bearer fixture-credential-marker" https://example.invalid; :',
		"curl -H 'Authorization: Bearer fixture-credential-marker' https://example.invalid",
		'curl --header Authorization: Bearer fixture-credential-marker https://example.invalid',
		'curl --token "fixture credential marker" https://example.invalid',
		'curl --password=fixture-credential-marker https://example.invalid',
		'curl --api-key fixture-credential-marker https://example.invalid',
		'curl Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4YWJj https://example.invalid'
	]
	assert.deepStrictEqual(
		Array.map(scripts, script => commandLabel(['/bin/bash', '-c', script], Option.none())),
		Array.map(scripts, () => ({detail: 'example.invalid', name: 'curl'}))
	)
})
