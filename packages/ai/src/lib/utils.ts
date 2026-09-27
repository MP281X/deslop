import {Array, Boolean, Chunk, MutableHashMap, MutableRef, Option, Predicate, String, pipe} from 'effect'

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

export function makeConversationReducer(): ConversationReducer {
	const turns = Array.empty<ConversationTurn>()
	const tools = MutableHashMap.empty<string, ToolView>()
	const content = MutableRef.make(
		Option.none<{append: (delta: string) => void; id: string; type: 'reasoning' | 'text'}>()
	)

	function makeContentSection(id: string, type: 'reasoning' | 'text', delta: string) {
		const text = MutableRef.make({cached: delta, pending: Chunk.empty<string>()})
		const view = {
			get content() {
				const current = MutableRef.get(text)
				const cached = `${current.cached}${Chunk.join(current.pending, '')}`
				MutableRef.set(text, {cached, pending: Chunk.empty()})
				return cached
			},
			id,
			type
		} satisfies ConversationSection
		return {
			append: (next: string) => {
				MutableRef.update(text, current => ({...current, pending: Chunk.append(current.pending, next)}))
			},
			view
		}
	}

	function value(): Conversation {
		return {turns}
	}

	function push(event: Ai.Event) {
		if (Prompt.isMessage(event)) {
			turns[Array.length(turns)] = {id: `turn-${Array.length(turns)}`, sections: [], user: event}
			MutableRef.set(content, Option.none())
			return value()
		}
		const current = Option.getOrUndefined(Array.last(turns))
		if (Predicate.isUndefined(current)) return value()

		if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
			if (String.isEmpty(event.delta)) return value()
			const type = Boolean.match(event.type === 'text-delta', {
				onFalse: () => 'reasoning' as const,
				onTrue: () => 'text' as const
			})
			return pipe(
				MutableRef.get(content),
				Option.filter(open => open.type === type && open.id === event.id),
				Option.match({
					onNone: () => {
						const section = makeContentSection(event.id, type, event.delta)
						current.sections[Array.length(current.sections)] = section.view
						MutableRef.set(content, Option.some({append: section.append, id: event.id, type}))
						return value()
					},
					onSome: open => {
						open.append(event.delta)
						return value()
					}
				})
			)
		}

		MutableRef.set(content, Option.none())

		if (event.type === 'tool-call') {
			pipe(
				Array.last(current.sections),
				Option.filter(previous => previous.type === 'tools'),
				Option.match({
					onNone: () => {
						current.sections[Array.length(current.sections)] = {tools: [event], type: 'tools'}
					},
					onSome: previous => {
						current.sections[Array.length(current.sections) - 1] = {
							tools: Array.append(previous.tools, event),
							type: 'tools'
						}
					}
				})
			)
			MutableHashMap.set(tools, event.id, event)
			return value()
		}

		if (event.type === 'tool-result') {
			const matched = pipe(
				MutableHashMap.get(tools, event.id),
				Option.filter(tool => tool.name === event.name)
			)
			for (const tool of Option.toArray(matched)) {
				tool.result = event
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

type PromptHistory = {
	messages: Prompt.Message[]
	response: Response.AnyPart[]
	section: Option.Option<{content: Chunk.Chunk<string>; id: string; type: 'reasoning' | 'text'}>
}

function flushSection(history: PromptHistory) {
	return Option.match(history.section, {
		onNone: () => history,
		onSome: section => {
			const text = Chunk.join(section.content, '')
			return {
				...history,
				response: Array.append(
					history.response,
					Boolean.match(section.type === 'text', {
						onFalse: () => Response.makePart('reasoning', {text}),
						onTrue: () => Response.makePart('text', {text})
					})
				),
				section: Option.none()
			}
		}
	})
}

function flushResponse(history: PromptHistory) {
	const flushed = flushSection(history)
	return {
		...flushed,
		messages: Array.appendAll(flushed.messages, Prompt.fromResponseParts(flushed.response).content),
		response: []
	}
}

function appendPromptEvent(history: PromptHistory, event: Ai.Event) {
	if (Prompt.isMessage(event)) {
		const flushed = flushResponse(history)
		return {...flushed, messages: Array.append(flushed.messages, event)}
	}
	if (event.type === 'text-delta' || event.type === 'reasoning-delta') {
		const type = Boolean.match(event.type === 'text-delta', {
			onFalse: () => 'reasoning' as const,
			onTrue: () => 'text' as const
		})
		return pipe(
			history.section,
			Option.filter(section => section.type === type && section.id === event.id),
			Option.match({
				onNone: () => ({
					...flushSection(history),
					section: Option.some({content: Chunk.of(event.delta), id: event.id, type})
				}),
				onSome: section => ({
					...history,
					section: Option.some({...section, content: Chunk.append(section.content, event.delta)})
				})
			})
		)
	}
	if (event.type === 'tool-call' || (event.type === 'tool-result' && !event.preliminary)) {
		const flushed = flushSection(history)
		return {...flushed, response: Array.append(flushed.response, event)}
	}
	return history
}

export function promptFromEvents(events: Ai.Event[]) {
	return Prompt.fromMessages(
		flushResponse(Array.reduce(events, {messages: [], response: [], section: Option.none()}, appendPromptEvent))
			.messages
	)
}
