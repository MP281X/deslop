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

it('keeps streamed content intact when reading between deltas', () => {
	const reducer = makeConversationReducer()
	reducer.pushAll([
		Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Read it'})]}),
		Response.makePart('text-delta', {delta: 'Read', id: 'answer'})
	])
	assert.containsSubset(reducer.value().turns, [{sections: [{content: 'Read', id: 'answer', type: 'text'}]}])
	reducer.pushAll([Response.makePart('text-delta', {delta: 'ing now.', id: 'answer'})])
	assert.containsSubset(reducer.value().turns, [{sections: [{content: 'Reading now.', id: 'answer', type: 'text'}]}])
	assert.containsSubset(reducer.value().turns, [{sections: [{content: 'Reading now.', id: 'answer', type: 'text'}]}])
})

it('starts a fresh streamed-content turn for each user message', () => {
	const reducer = makeConversationReducer()
	reducer.pushAll([
		Response.makePart('text-delta', {delta: 'ignored', id: 'answer'}),
		Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'First prompt'})]}),
		Response.makePart('text-delta', {delta: 'Fir', id: 'answer'}),
		Response.makePart('text-delta', {delta: 'st', id: 'answer'}),
		Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Second prompt'})]}),
		Response.makePart('text-delta', {delta: 'Second', id: 'answer'})
	])

	assert.deepStrictEqual(
		Array.map(reducer.value().turns, turn => ({
			sections: Array.map(turn.sections, section => (section.type === 'text' ? section.content : section.type)),
			user: Array.map(turn.user.content, part => (part.type === 'text' ? part.text : part.type))
		})),
		[
			{sections: ['First'], user: ['First prompt']},
			{sections: ['Second'], user: ['Second prompt']}
		]
	)

	reducer.pushAll([Response.makePart('text-delta', {delta: ' turn', id: 'answer'})])
	assert.deepStrictEqual(
		Array.map(reducer.value().turns, turn => ({
			sections: Array.map(turn.sections, section => (section.type === 'text' ? section.content : section.type)),
			user: Array.map(turn.user.content, part => (part.type === 'text' ? part.text : part.type))
		})),
		[
			{sections: ['First'], user: ['First prompt']},
			{sections: ['Second turn'], user: ['Second prompt']}
		]
	)
})

it('replaces preliminary tool results only with a matching final result and keeps it after completion', () => {
	const reducer = makeConversationReducer()
	const preliminary = [
		{
			sections: [
				{
					tools: [{id: 'read-1', name: 'read', result: {name: 'read', preliminary: true, result: 'partial'}}],
					type: 'tools'
				}
			]
		}
	]
	const final = [
		{
			sections: [
				{
					tools: [{id: 'read-1', name: 'read', result: {name: 'read', preliminary: false, result: 'contents'}}],
					type: 'tools'
				}
			]
		}
	]

	reducer.pushAll([
		Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: 'Read it'})]}),
		Response.makePart('tool-call', {id: 'read-1', name: 'read', params: {path: 'README.md'}, providerExecuted: false}),
		Response.makePart('tool-result', {
			encodedResult: 'partial',
			id: 'read-1',
			isFailure: false,
			name: 'read',
			preliminary: true,
			providerExecuted: false,
			result: 'partial'
		})
	])
	assert.containsSubset(reducer.value().turns, preliminary)

	reducer.pushAll([
		Response.makePart('tool-result', {
			encodedResult: 'directory listing',
			id: 'read-1',
			isFailure: false,
			name: 'ls',
			preliminary: false,
			providerExecuted: false,
			result: 'directory listing'
		})
	])
	assert.containsSubset(reducer.value().turns, preliminary)

	reducer.pushAll([
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
	assert.containsSubset(reducer.value().turns, final)

	reducer.pushAll([
		Response.makePart('tool-result', {
			encodedResult: 'late contents',
			id: 'read-1',
			isFailure: false,
			name: 'read',
			preliminary: false,
			providerExecuted: false,
			result: 'late contents'
		})
	])
	assert.containsSubset(reducer.value().turns, final)
})
