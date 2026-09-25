import {Array, Boolean, Chunk, MutableHashMap, Option, String} from 'effect'

import {Prompt, Response} from 'effect/unstable/ai'

import type {Ai} from '#service'

type ToolName = Response.ToolCallParts<Ai.Tools>['name']

export type ToolView = {
	[Name in ToolName]: Extract<Response.ToolCallParts<Ai.Tools>, {name: Name}> & {
		result?: Extract<Response.ToolResultParts<Ai.Tools>, {name: Name}>
	}
}[ToolName]

export type ConversationSection =
	| {content: string; id: string; type: 'text'}
	| {content: string; id: string; type: 'reasoning'}
	| {tools: ToolView[]; type: 'tools'}

export type ConversationTurn = {
	error?: Response.ErrorPart
	finish?: Response.FinishPart
	id: string
	sections: ConversationSection[]
	user: Prompt.UserMessage
}

export type Conversation = {turns: ConversationTurn[]}

export type ConversationReducer = {
	push: (event: Ai.Event) => Conversation
	pushAll: (events: Ai.Event[]) => Conversation
	value: () => Conversation
}

function isUserMessage(event: Ai.Event): event is Prompt.UserMessage {
	return Prompt.isMessage(event)
}

export function makeConversationReducer(): ConversationReducer {
	const turns: ConversationTurn[] = []
	const tools = MutableHashMap.empty<string, ToolView>()
	let turn = Option.none<ConversationTurn>()
	let content = Option.none<{append: (delta: string) => void; id: string; type: 'reasoning' | 'text'}>()

	function makeContentSection(id: string, type: 'reasoning' | 'text', delta: string) {
		let cached = ''
		let pending: Chunk.Chunk<string> = Chunk.of(delta)
		const view = {
			get content() {
				cached += Chunk.join(pending, '')
				pending = Chunk.empty()
				return cached
			},
			id,
			type
		} satisfies ConversationSection
		return {
			append: (next: string) => {
				pending = Chunk.append(pending, next)
			},
			view
		}
	}

	function value(): Conversation {
		return {turns}
	}

	function push(event: Ai.Event) {
		if (isUserMessage(event)) {
			const next = {id: `turn-${Array.length(turns)}`, sections: [], user: event} satisfies ConversationTurn
			turns[Array.length(turns)] = next
			turn = Option.some(next)
			content = Option.none()
			return value()
		}
		if (Option.isNone(turn)) return value()
		const current = turn.value

		if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
			if (String.isEmpty(event.delta)) return value()
			const type: 'reasoning' | 'text' = Boolean.match(event.type === 'text-delta', {
				onFalse: () => 'reasoning',
				onTrue: () => 'text'
			})
			if (Option.isSome(content) && content.value.type === type && content.value.id === event.id) {
				content.value.append(event.delta)
				return value()
			}
			const section = makeContentSection(event.id, type, event.delta)
			current.sections[Array.length(current.sections)] = section.view
			content = Option.some({append: section.append, id: event.id, type})
			return value()
		}

		content = Option.none()

		if (event.type === 'tool-call') {
			const view: ToolView = event
			const previous = Array.last(current.sections)
			if (Option.isSome(previous) && previous.value.type === 'tools') {
				previous.value.tools[Array.length(previous.value.tools)] = view
			} else {
				current.sections[Array.length(current.sections)] = {tools: [view], type: 'tools'}
			}
			MutableHashMap.set(tools, event.id, view)
			return value()
		}

		if (event.type === 'tool-result') {
			const tool = MutableHashMap.get(tools, event.id)
			if (Option.isSome(tool) && tool.value.name === event.name) {
				tool.value.result = event
				if (!event.preliminary) MutableHashMap.remove(tools, event.id)
			}
			return value()
		}

		if (event.type === 'finish') current.finish = event
		if (event.type === 'error') current.error = event
		return value()
	}

	function pushAll(events: Ai.Event[]) {
		for (const event of events) push(event)
		return value()
	}

	return {push, pushAll, value}
}

export function promptFromEvents(events: Ai.Event[]) {
	const messages: Prompt.Message[] = []
	let response: Response.AnyPart[] = []
	let section = Option.none<{content: Chunk.Chunk<string>; id: string; type: 'reasoning' | 'text'}>()

	function flushSection() {
		if (Option.isNone(section)) return
		const current = section.value
		if (current.type === 'text') {
			response[Array.length(response)] = Response.makePart('text', {text: Chunk.join(current.content, '')})
		} else {
			response[Array.length(response)] = Response.makePart('reasoning', {text: Chunk.join(current.content, '')})
		}
		section = Option.none()
	}

	function flushResponse() {
		flushSection()
		for (const message of Prompt.fromResponseParts(response).content) messages[Array.length(messages)] = message
		response = []
	}

	for (const event of events) {
		if (isUserMessage(event)) {
			flushResponse()
			messages[Array.length(messages)] = event
		} else if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
			const type: 'reasoning' | 'text' = Boolean.match(event.type === 'text-delta', {
				onFalse: () => 'reasoning',
				onTrue: () => 'text'
			})
			if (Option.isSome(section) && section.value.type === type && section.value.id === event.id) {
				section = Option.some({...section.value, content: Chunk.append(section.value.content, event.delta)})
			} else {
				flushSection()
				section = Option.some({content: Chunk.of(event.delta), id: event.id, type})
			}
		} else if (event.type === 'tool-call' || (event.type === 'tool-result' && !event.preliminary)) {
			flushSection()
			response[Array.length(response)] = event
		}
	}
	flushResponse()
	return Prompt.fromMessages(messages)
}
