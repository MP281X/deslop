import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {commandLabel} from './command.ts'

it('labels a wrapped command by what it runs, past the wrapper’s flag values and operands', () => {
	assert.deepStrictEqual(commandLabel(['timeout', '5', 'node', 'server.js'], Option.none()).name, 'server.js')
	assert.deepStrictEqual(commandLabel(['sudo', '-u', 'dev', 'node', 'server.js'], Option.none()).name, 'server.js')
	assert.deepStrictEqual(commandLabel(['env', 'PORT=1', 'nice', '-n', '5', 'vite-plus', 'dev'], Option.none()), {
		detail: 'dev',
		name: 'vp'
	})
})
