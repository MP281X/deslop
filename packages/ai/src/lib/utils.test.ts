import {expect, it} from '@effect/vitest'

import {Prompt, Response} from 'effect/unstable/ai'

import {makeConversationReducer, promptFromEvents} from './utils.ts'

it('reduces deltas and groups consecutive typed tools', () => {
	const reducer = makeConversationReducer()
	const user = Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Inspect the project'})]})
	const read = Response.makePart('tool-call', {
		id: 'read-1',
		name: 'read',
		params: {path: 'package.json'},
		providerExecuted: false
	})
	const ls = Response.makePart('tool-call', {id: 'ls-1', name: 'ls', params: {path: '.'}, providerExecuted: false})
	const readResult = Response.makePart('tool-result', {
		encodedResult: '{}',
		id: 'read-1',
		isFailure: false,
		name: 'read',
		preliminary: false,
		providerExecuted: false,
		result: '{}'
	})

	const conversation = reducer.pushAll([
		user,
		Response.makePart('text-delta', {delta: 'I will ', id: 'answer'}),
		Response.makePart('text-delta', {delta: 'inspect it.', id: 'answer'}),
		read,
		readResult,
		ls,
		Response.makePart('reasoning-delta', {delta: 'Done.', id: 'reasoning'}),
		Response.makePart('tool-call', {id: 'read-2', name: 'read', params: {path: 'README.md'}, providerExecuted: false}),
		Response.makePart('error', {error: 'failed'}),
		Response.makePart('finish', {
			reason: 'error',
			response: undefined,
			usage: Response.Usage.make({
				inputTokens: {cacheRead: undefined, cacheWrite: undefined, total: undefined, uncached: undefined},
				outputTokens: {reasoning: undefined, text: undefined, total: undefined}
			})
		})
	])

	expect(conversation.turns).toHaveLength(1)
	expect(conversation.turns[0]).toMatchObject({error: {error: 'failed'}, finish: {reason: 'error'}})
	expect(conversation.turns[0]?.sections).toHaveLength(4)
	expect(conversation.turns[0]?.sections[0]).toMatchObject({content: 'I will inspect it.', type: 'text'})
	expect(conversation.turns[0]?.sections[1]).toMatchObject({
		tools: [{name: 'read', result: {result: '{}'}}, {name: 'ls'}],
		type: 'tools'
	})
	expect(conversation.turns[0]?.sections[2]).toMatchObject({content: 'Done.', type: 'reasoning'})
	expect(conversation.turns[0]?.sections[3]).toMatchObject({tools: [{name: 'read'}], type: 'tools'})
})

it('reconstructs Effect Prompt history from compact events', () => {
	const user = Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Read it'})]})
	const history = promptFromEvents([
		user,
		Response.makePart('reasoning-delta', {delta: 'Need the file.', id: 'thought'}),
		Response.makePart('text-delta', {delta: 'Reading ', id: 'answer'}),
		Response.makePart('text-delta', {delta: 'now.', id: 'answer'}),
		Response.makePart('tool-call', {id: 'read-1', name: 'read', params: {path: 'README.md'}, providerExecuted: false}),
		Response.makePart('tool-result', {
			encodedResult: 'partial',
			id: 'read-1',
			isFailure: false,
			name: 'read',
			preliminary: true,
			providerExecuted: false,
			result: 'partial'
		}),
		Response.makePart('tool-result', {
			encodedResult: 'contents',
			id: 'read-1',
			isFailure: false,
			name: 'read',
			preliminary: false,
			providerExecuted: false,
			result: 'contents'
		})
	])

	expect(history.content).toMatchObject([
		{role: 'user'},
		{
			content: [
				{text: 'Need the file.', type: 'reasoning'},
				{text: 'Reading now.', type: 'text'},
				{name: 'read', type: 'tool-call'}
			],
			role: 'assistant'
		},
		{content: [{name: 'read', result: 'contents', type: 'tool-result'}], role: 'tool'}
	])
})
