import {assert, it} from '@effect/vitest'

import {HashMap, Option} from 'effect'

import type {RemoteTool} from './contract.ts'
import {compact, prunedTools} from './descriptors.ts'

import {ConnectionGeneration, ServerId} from '#connections/contract.ts'
import type {ConnectionState} from '#connections/contract.ts'

function state(id: string, generation: string, status: ConnectionState['status']) {
	return {
		error: Option.none(),
		generation: ConnectionGeneration.make(generation),
		icons: [],
		id: ServerId.make(id),
		instructions: Option.none(),
		issuer: Option.none(),
		mode: 'public',
		name: id,
		scope: Option.none(),
		status,
		tools: 0,
		url: `https://${id}.example.test`
	} satisfies ConnectionState
}

it('drops the tools of a server that is gone, replaced or not connected', () => {
	const installed = HashMap.make(
		['kept__a', {generation: ConnectionGeneration.make('one'), id: ServerId.make('kept')}],
		['replaced__a', {generation: ConnectionGeneration.make('old'), id: ServerId.make('replaced')}],
		['paused__a', {generation: ConnectionGeneration.make('one'), id: ServerId.make('paused')}],
		['gone__a', {generation: ConnectionGeneration.make('one'), id: ServerId.make('gone')}]
	)
	const definitions = [
		state('kept', 'one', 'Connected'),
		state('replaced', 'new', 'Connected'),
		state('paused', 'one', 'Not connected')
	]
	assert.sameMembers(prunedTools(definitions, installed), ['replaced__a', 'paused__a', 'gone__a'])
})

it('shows an agent only the schema bounds that say something', () => {
	const tool: RemoteTool = {
		inputSchema: {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			additionalProperties: true,
			properties: Option.some({
				limit: {maximum: 100, minimum: 1, type: 'integer'},
				offset: {maximum: 9_007_199_254_740_991, minimum: -9_007_199_254_740_991, type: 'integer'}
			}),
			type: 'object'
		},
		name: 'list'
	}
	assert.deepStrictEqual(compact(tool).inputSchema, {
		properties: {limit: {maximum: 100, minimum: 1, type: 'integer'}, offset: {type: 'integer'}},
		type: 'object'
	})
})
