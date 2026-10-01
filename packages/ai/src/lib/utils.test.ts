import {assert, it} from '@effect/vitest'

import {Array, Predicate} from 'effect'

import {Prompt, Response} from 'effect/ai'

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

	assert.lengthOf(conversation.turns, 1)
	assert.containsSubset(conversation.turns[0], {error: {error: 'failed'}, finish: {reason: 'error'}})
	assert.deepStrictEqual(
		Array.map(conversation.turns[0]?.sections ?? [], section =>
			section.type === 'tools' ? Array.map(section.tools, tool => tool.name) : section.type
		),
		['text', ['read', 'ls'], 'reasoning', ['read']]
	)
	assert.containsSubset(conversation.turns[0]?.sections, [
		{content: 'I will inspect it.', type: 'text'},
		{tools: [{name: 'read', result: {result: '{}'}}], type: 'tools'},
		{content: 'Done.', type: 'reasoning'}
	])
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

	assert.deepStrictEqual(
		Array.map(history.content, message =>
			Predicate.isString(message.content) ? message.content : Array.map(message.content, part => part.type)
		),
		[['text'], ['reasoning', 'text', 'tool-call'], ['tool-result']]
	)
	assert.containsSubset(history.content, [
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
