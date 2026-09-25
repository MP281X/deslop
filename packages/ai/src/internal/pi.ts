import type {Context} from 'effect'
import {
	Array,
	Boolean,
	DateTime,
	Effect,
	Encoding,
	HashMap,
	Inspectable,
	Match,
	Option,
	Predicate,
	Record,
	Result,
	Schema,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {
	Agent,
	DEFAULT_COMPACTION_SETTINGS,
	InMemorySessionRepo,
	buildSessionContext,
	compact,
	estimateContextTokens,
	getOrThrow,
	prepareCompaction,
	shouldCompact,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult
} from '@earendil-works/pi-agent-core'
import type {
	Api,
	AssistantMessage,
	ImageContent,
	Message,
	Model,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage
} from '@earendil-works/pi-ai'
import {Type} from '@earendil-works/pi-ai'
import {Prompt, Response, Tool} from 'effect/unstable/ai'

import {AiError as ServiceAiError, type AiAgentDefinition, type AiSkill, type AiStatus} from '#schema'
import type {Ai, Pi} from '#service'

import {makeReplay} from './replay.ts'

function imageDataFromFilePart(part: Prompt.FilePart) {
	if (part.data instanceof URL) return
	if (!Predicate.isString(part.data)) return Encoding.encodeBase64(part.data)
	const prefix = `data:${part.mediaType};base64,`
	if (String.startsWith(prefix)(part.data)) return String.slice(String.length(prefix))(part.data)
	return part.data
}

function imageFromFilePart(part: Prompt.FilePart) {
	if (!String.startsWith('image/')(part.mediaType)) return
	const data = imageDataFromFilePart(part)
	if (Predicate.isUndefined(data)) return
	return {data, mimeType: part.mediaType, type: 'image'} satisfies ImageContent
}

const piContentFromPrompt = Effect.fnUntraced(function* (message: Prompt.UserMessage) {
	return Array.flatten(
		yield* Effect.forEach(message.content, (part): Effect.Effect<(TextContent | ImageContent)[], ServiceAiError> => {
			if (part.type === 'text') return Effect.succeed([{text: part.text, type: 'text'} satisfies TextContent])
			const image = imageFromFilePart(part)
			if (Predicate.isNotUndefined(image)) return Effect.succeed([image])
			return Effect.fail(ServiceAiError.make({message: `Pi does not support ${part.mediaType} prompt parts`}))
		})
	)
})

const piUserMessage = Effect.fnUntraced(function* (message: Prompt.UserMessage) {
	return {
		content: yield* piContentFromPrompt(message),
		role: 'user',
		timestamp: DateTime.toEpochMillis(yield* DateTime.now)
	} satisfies Message
})

const piMessagesFromPrompt = Effect.fnUntraced(function* (prompt: Prompt.Prompt, model: Model<Api>) {
	const timestamp = DateTime.toEpochMillis(yield* DateTime.now)
	return Array.flatten(
		yield* Effect.forEach(prompt.content, (message): Effect.Effect<Message[], ServiceAiError> => {
			if (message.role === 'system') return Effect.succeed(Array.empty<Message>())
			if (message.role === 'user') return pipe(piUserMessage(message), Effect.map(Array.of))
			if (message.role === 'assistant') {
				const content = Array.flatMap(message.content, (part): (TextContent | ThinkingContent | ToolCall)[] => {
					if (part.type === 'text') return [{text: part.text, type: 'text'}]
					if (part.type === 'reasoning') return [{thinking: part.text, type: 'thinking'}]
					if (part.type !== 'tool-call') return Array.empty()
					return pipe(
						Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(part.params),
						Option.map(
							params => ({arguments: params, id: part.id, name: part.name, type: 'toolCall'}) satisfies ToolCall
						),
						Option.toArray
					)
				})
				return Effect.succeed([
					{
						api: model.api,
						content,
						model: model.id,
						provider: model.provider,
						role: 'assistant',
						stopReason: 'stop',
						timestamp,
						usage: {
							cacheRead: 0,
							cacheWrite: 0,
							cost: {cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0},
							input: 0,
							output: 0,
							reasoning: 0,
							totalTokens: 0
						}
					} satisfies AssistantMessage
				])
			}
			return Effect.succeed(
				Array.filterMap(message.content, part => {
					if (part.type !== 'tool-result') return Result.failVoid
					return Result.succeed({
						content: [{text: textFromUnknown(part.result), type: 'text'}],
						details: part.result,
						isError: part.isFailure,
						role: 'toolResult',
						timestamp,
						toolCallId: part.id,
						toolName: part.name
					} satisfies ToolResultMessage)
				})
			)
		})
	)
})

function textFromUnknown(value: unknown) {
	if (Predicate.isString(value)) return value
	if (Predicate.isUndefined(value)) return 'undefined'
	return Inspectable.toStringUnknown(value)
}

function isPiMessage(message: AgentMessage): message is Message {
	return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
}

function promptUserMessage(message: AgentMessage) {
	if (!isPiMessage(message) || message.role !== 'user') return
	if (Predicate.isString(message.content)) {
		return Prompt.makeMessage('user', {content: [Prompt.makePart('text', {text: message.content})]})
	}
	const content = pipe(
		message.content,
		Array.map(part => {
			if (part.type === 'text') return Prompt.makePart('text', {text: part.text})
			return Prompt.makePart('file', {data: part.data, mediaType: part.mimeType})
		})
	)
	return Prompt.makeMessage('user', {content})
}

function toolResult(value: unknown) {
	return {content: [{text: textFromUnknown(value), type: 'text'}], details: value} satisfies AgentToolResult<unknown>
}

function formatSkills(skills: AiSkill[]) {
	if (Array.length(skills) === 0) return ''
	return Array.join('\n')([
		'The skill tool exposes specialized instructions. Invoke a skill when its description matches the task.',
		'<available_skills>',
		...Array.map(
			skills,
			skill => `  <skill><name>${skill.name}</name><description>${skill.description}</description></skill>`
		),
		'</available_skills>'
	])
}

function formatAgents(agents: AiAgentDefinition[]) {
	if (Array.length(agents) === 0) return ''
	return Array.join('\n')([
		'The subagent tool delegates one focused task to an isolated agent.',
		'<available_agents>',
		...Array.map(
			agents,
			agent => `  <agent><name>${agent.name}</name><description>${agent.description}</description></agent>`
		),
		'</available_agents>'
	])
}

function skillTool<R>(skills: AiSkill[], context: Context.Context<R>) {
	return {
		description: 'Load the complete instructions and embedded resources for one available skill.',
		execute: (_toolCallId, params) =>
			Effect.runPromiseWith(context)(
				Effect.gen(function* () {
					const input = yield* Schema.decodeUnknownEffect(Schema.Struct({name: Schema.String}))(params)
					const skill = Array.findFirst(skills, candidate => candidate.name === input.name)
					if (Option.isNone(skill)) return yield* ServiceAiError.make({message: `Unknown skill: ${input.name}`})
					if (Predicate.isUndefined(skill.value.resources)) return toolResult(skill.value.instructions)
					const resources = pipe(
						Record.toEntries(skill.value.resources),
						Array.map(([name, content]) => `<resource name="${name}">\n${content}\n</resource>`),
						Array.join('\n')
					)
					return toolResult(`${skill.value.instructions}\n\n<resources>\n${resources}\n</resources>`)
				})
			),
		executionMode: 'parallel',
		label: 'skill',
		name: 'skill',
		parameters: Type.Object({name: Type.String({enum: Array.map(skills, skill => skill.name)})})
	} satisfies AgentTool
}

function assistantText(messages: AgentMessage[]) {
	const last = Array.findLast(messages, message => message.role === 'assistant')
	if (Option.isNone(last)) return ''
	return pipe(
		last.value.content,
		Array.filterMap(part => {
			if (part.type === 'text') return Result.succeed(part.text)
			return Result.failVoid
		}),
		Array.join('\n')
	)
}

function knownTool(name: string, tools: Ai.Tools): name is keyof Ai.Tools {
	return Array.some(Record.keys(tools), candidate => candidate === name)
}

function partsFromEvent(event: AgentEvent, tools: Ai.Tools): (Prompt.UserMessage | Response.AnyPart)[] {
	if (event.type === 'message_start') {
		const message = promptUserMessage(event.message)
		if (Predicate.isUndefined(message)) return []
		return [message]
	}
	if (event.type === 'message_update') {
		const update = event.assistantMessageEvent
		if (update.type === 'text_delta' && String.isNonEmpty(update.delta)) {
			return [Response.makePart('text-delta', {delta: update.delta, id: update.partial.responseId ?? 'text'})]
		}
		if (update.type === 'thinking_delta' && String.isNonEmpty(update.delta)) {
			return [Response.makePart('reasoning-delta', {delta: update.delta, id: update.partial.responseId ?? 'reasoning'})]
		}
		if (update.type === 'toolcall_end' && knownTool(update.toolCall.name, tools)) {
			return [
				Response.makePart('tool-call', {
					id: update.toolCall.id,
					name: update.toolCall.name,
					params: update.toolCall.arguments,
					providerExecuted: false
				})
			]
		}
	}
	if (event.type === 'tool_execution_end' && knownTool(event.toolName, tools)) {
		let details: unknown
		if (Predicate.hasProperty(event.result, 'details')) details = event.result.details
		return [
			Response.makePart('tool-result', {
				encodedResult: details,
				id: event.toolCallId,
				isFailure: event.isError,
				name: event.toolName,
				preliminary: false,
				providerExecuted: false,
				result: details
			})
		]
	}
	if (
		event.type === 'message_end' &&
		event.message.role === 'assistant' &&
		Predicate.isString(event.message.errorMessage)
	) {
		return [Response.makePart('error', {error: event.message.errorMessage})]
	}
	return []
}

function finishPart(message: AgentMessage) {
	if (message.role === 'assistant') {
		return Response.makePart('finish', {
			reason: pipe(
				Match.value(message.stopReason),
				Match.when('stop', () => 'stop' as const),
				Match.when('length', () => 'length' as const),
				Match.when('toolUse', () => 'tool-calls' as const),
				Match.when('pending', () => 'error' as const),
				Match.when('deferred', () => 'pause' as const),
				Match.when('aborted', () => 'other' as const),
				Match.when('error', () => 'error' as const),
				Match.exhaustive
			),
			response: undefined,
			usage: Response.Usage.make({
				inputTokens: {
					cacheRead: message.usage.cacheRead,
					cacheWrite: message.usage.cacheWrite,
					total: message.usage.input,
					uncached: message.usage.input - message.usage.cacheRead
				},
				outputTokens: {reasoning: message.usage.reasoning, text: message.usage.output, total: message.usage.output}
			})
		})
	}
	return Response.makePart('finish', {
		reason: 'stop',
		response: undefined,
		usage: Response.Usage.make({
			inputTokens: {cacheRead: undefined, cacheWrite: undefined, total: undefined, uncached: undefined},
			outputTokens: {reasoning: undefined, text: undefined, total: undefined}
		})
	})
}

function isUserMessage(event: Ai.Event): event is Prompt.UserMessage {
	return Prompt.isMessage(event)
}

export const makePi = Effect.fnUntraced(function* (config: Pi.Config) {
	const resolvedModel = config.models.getModel(config.model.provider, config.model.id)
	if (Predicate.isUndefined(resolvedModel)) {
		return yield* ServiceAiError.make({message: `Unknown model: ${config.model.id}`})
	}
	const model: Model<Api> = resolvedModel
	const handledToolkit = yield* config.toolkit
	const toolContext: Context.Context<Tool.HandlerServices<Ai.Tools[keyof Ai.Tools]>> = yield* Effect.context()
	const ownerContext: Context.Context<Tool.HandlerServices<Ai.Tools[keyof Ai.Tools]>> = yield* Effect.context()
	const status = yield* SubscriptionRef.make<AiStatus>('idle')
	function decodeEvent(event: Prompt.UserMessage | Response.AnyPart): Effect.Effect<Ai.Event, ServiceAiError> {
		if (Prompt.isMessage(event)) return Effect.succeed(event)
		return pipe(
			Schema.decodeUnknownEffect(Response.StreamPart(config.toolkit))(event),
			Effect.mapError(cause => ServiceAiError.make({cause, message: 'Invalid normalized Pi event'}))
		)
	}
	const initialEvents = yield* Effect.forEach(
		Array.flatMap(
			(config.history ?? Prompt.empty).content,
			(message, messageIndex): (Prompt.UserMessage | Response.AnyPart)[] => {
				if (message.role === 'user') return [message]
				if (message.role === 'system') return []
				if (message.role === 'tool') {
					return Array.flatMap(message.content, part => {
						if (part.type !== 'tool-result' || !knownTool(part.name, handledToolkit.tools)) return []
						return [
							Response.makePart('tool-result', {
								encodedResult: part.result,
								id: part.id,
								isFailure: part.isFailure,
								name: part.name,
								preliminary: false,
								providerExecuted: part.providerExecuted,
								result: part.result
							})
						]
					})
				}
				return Array.flatMap(message.content, (part, partIndex): Response.AnyPart[] => {
					const id = `history-${messageIndex}-${partIndex}`
					if (part.type === 'text') return [Response.makePart('text-delta', {delta: part.text, id})]
					if (part.type === 'reasoning') return [Response.makePart('reasoning-delta', {delta: part.text, id})]
					if (part.type !== 'tool-call' || !knownTool(part.name, handledToolkit.tools)) return []
					return [
						Response.makePart('tool-call', {
							id: part.id,
							name: part.name,
							params: part.params,
							providerExecuted: part.providerExecuted
						})
					]
				})
			}
		),
		decodeEvent
	)
	const replay = yield* makeReplay(initialEvents)
	function setStatus(next: AiStatus) {
		return SubscriptionRef.set(status, next)
	}
	const agentDefinitions = config.agents ?? []
	const definitions = pipe(
		agentDefinitions,
		Array.map(definition => [definition.name, definition] as const),
		HashMap.fromIterable
	)

	const makeRuntime = Effect.fnUntraced(function* (
		profile: AiAgentDefinition,
		allowSubagents: boolean,
		history: Prompt.Prompt
	) {
		const session = yield* Effect.tryPromise({
			catch: cause => ServiceAiError.make({cause, message: 'Failed to create Pi session'}),
			try: () => new InMemorySessionRepo().create({})
		})
		const initialMessages = yield* piMessagesFromPrompt(history, model)
		yield* Effect.forEach(
			initialMessages,
			message =>
				Effect.tryPromise({
					catch: cause => ServiceAiError.make({cause, message: 'Failed to initialize Pi history'}),
					try: () => session.appendMessage(message)
				}),
			{discard: true}
		)
		const enabledNames = pipe(
			Record.keys(handledToolkit.tools),
			Array.filter(name => Array.some(profile.tools, configured => configured === name))
		)
		if (Array.length(enabledNames) !== Array.length(profile.tools)) {
			return yield* ServiceAiError.make({message: `Agent ${profile.name} enables an unknown tool`})
		}
		const tools: AgentTool[] = pipe(
			enabledNames,
			Array.filterMap(name => {
				const selected = Record.get(handledToolkit.tools, name)
				if (Option.isNone(selected) || Tool.isProviderDefined(selected.value)) return Result.failVoid
				const tool = selected.value
				let description: string = name
				if (Predicate.isString(tool.description)) description = tool.description
				return Result.succeed({
					description,
					execute: (toolCallId, params, _signal, onUpdate) =>
						Effect.runPromiseWith(toolContext)(
							pipe(
								Schema.decodeUnknownEffect(tool.parametersSchema)(params),
								Effect.mapError(cause => ServiceAiError.make({cause, message: `Invalid ${name} parameters`})),
								Effect.flatMap(input => handledToolkit.handle(name, input, toolCallId)),
								Effect.flatMap(stream =>
									pipe(
										stream,
										Stream.mapError(cause => ServiceAiError.make({cause, message: `${name} failed`})),
										Stream.tap(result => {
											if (!result.preliminary) return Effect.void
											return Effect.sync(() => onUpdate?.(toolResult(result.encodedResult)))
										}),
										Stream.filter(result => !result.preliminary),
										Stream.runLast
									)
								),
								Effect.map(Option.map(result => result.encodedResult)),
								Effect.map(value => toolResult(Option.getOrUndefined(value))),
								Effect.mapError(cause => ServiceAiError.make({cause, message: `${name} failed`}))
							)
						),
					executionMode: Boolean.match(name === 'write' || name === 'edit', {
						onFalse: () => 'parallel',
						onTrue: () => 'sequential'
					}),
					label: name,
					name,
					parameters: Type.Unsafe<unknown>(Tool.getJsonSchema(tool))
				} satisfies AgentTool)
			})
		)
		if (Array.length(profile.skills) > 0) {
			tools[Array.length(tools)] = skillTool(Array.fromIterable(profile.skills), ownerContext)
		}
		if (allowSubagents && Array.length(agentDefinitions) > 0) {
			tools[Array.length(tools)] = {
				description: 'Run one focused prompt with an isolated configured agent and return its final answer.',
				execute: (_toolCallId, params) =>
					Effect.runPromiseWith(ownerContext)(
						Effect.gen(function* () {
							const input = yield* Schema.decodeUnknownEffect(
								Schema.Struct({agent: Schema.String, prompt: Schema.String})
							)(params)
							const definition = HashMap.get(definitions, input.agent)
							if (Option.isNone(definition)) {
								return yield* ServiceAiError.make({message: `Unknown agent: ${input.agent}`})
							}
							const child = yield* makeRuntime(definition.value, false, Prompt.empty)
							yield* Effect.tryPromise({
								catch: cause => ServiceAiError.make({cause, message: `Subagent ${input.agent} failed`}),
								try: () => child.prompt(input.prompt)
							})
							return toolResult(assistantText(child.state.messages))
						})
					),
				executionMode: 'parallel',
				label: 'subagent',
				name: 'subagent',
				parameters: Type.Object({
					agent: Type.String({enum: Array.map(agentDefinitions, definition => definition.name)}),
					prompt: Type.String({description: 'Focused task for the selected agent'})
				})
			}
		}

		function compactContext(messages: AgentMessage[], signal?: AbortSignal) {
			return Effect.runPromiseWith(ownerContext)(
				pipe(
					Effect.gen(function* () {
						const entries = yield* Effect.promise(() => session.findEntriesOnBranch())
						const current = buildSessionContext(entries).messages
						const usage = estimateContextTokens(current)
						if (!shouldCompact(usage.tokens, model.contextWindow, DEFAULT_COMPACTION_SETTINGS)) return current
						const preparation = getOrThrow(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS))
						if (Predicate.isUndefined(preparation)) return current
						const result = getOrThrow(
							yield* Effect.promise(() =>
								compact(preparation, config.models, model, undefined, signal, config.model.reasoning)
							)
						)
						yield* Effect.promise(() =>
							session.appendEntry(
								{
									details: result.details,
									id: session.idGenerator.next(),
									retainedTail: result.retainedTail,
									summary: result.summary,
									tokensBefore: result.tokensBefore,
									type: 'compaction',
									usage: result.usage
								},
								'main'
							)
						)
						return pipe(
							yield* Effect.promise(() => session.findEntriesOnBranch()),
							buildSessionContext,
							value => value.messages
						)
					}),
					Effect.orElseSucceed(() => messages)
				)
			)
		}

		let subagents: AiAgentDefinition[] = []
		if (allowSubagents) subagents = agentDefinitions
		const agent = new Agent({
			...config.options,
			initialState: {
				messages: initialMessages,
				model,
				systemPrompt: pipe(
					[profile.instructions, formatSkills(Array.fromIterable(profile.skills)), formatAgents(subagents)],
					Array.filter(String.isNonEmpty),
					Array.join('\n\n')
				),
				thinkingLevel: config.model.reasoning,
				tools
			},
			sessionId: (yield* Effect.promise(() => session.getMetadata())).id,
			streamFn: config.models.streamSimple.bind(config.models),
			toolExecution: config.options?.toolExecution ?? 'parallel',
			transformContext: config.options?.transformContext ?? compactContext
		})
		agent.subscribe(event => {
			if (event.type !== 'message_end') return
			return Effect.runPromiseWith(ownerContext)(
				Effect.asVoid(Effect.promise(() => session.appendMessage(event.message)))
			)
		})
		return agent
	})

	const agent = yield* makeRuntime(config.main, true, config.history ?? Prompt.empty)
	let lastTurn = Option.none<AgentMessage>()
	const unsubscribe = agent.subscribe(event =>
		Effect.runPromiseWith(ownerContext)(
			Effect.gen(function* () {
				for (const part of partsFromEvent(event, handledToolkit.tools)) {
					yield* pipe(decodeEvent(part), Effect.flatMap(replay.publish))
				}
				if (event.type === 'turn_end') lastTurn = Option.some(event.message)
				if (event.type !== 'agent_end') return
				if (Option.isSome(lastTurn)) yield* replay.publish(finishPart(lastTurn.value))
				yield* setStatus('idle')
			})
		)
	)
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			unsubscribe()
			agent.abort()
		})
	)

	const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage) {
		const input = yield* piUserMessage(message)
		if (agent.state.isStreaming) {
			agent.steer(input)
			return
		}
		yield* setStatus('running')
		yield* pipe(
			Effect.tryPromise({
				catch: cause => ServiceAiError.make({cause, message: 'Pi prompt failed'}),
				try: () => agent.prompt(input)
			}),
			Effect.catch(error =>
				Effect.gen(function* () {
					yield* setStatus('error')
					yield* replay.publish(Response.makePart('error', {error: error.message}))
					return yield* error
				})
			)
		)
	})
	const stop = Effect.gen(function* () {
		if (!agent.state.isStreaming) return
		yield* setStatus('stopping')
		agent.abort()
	})

	return {events: replay.events, prompt, status, stop} satisfies Ai.Agent
})

export const generateTextPi = Effect.fn('Ai.generateText')(function* (config: Pi.Config, message: Prompt.UserMessage) {
	const agent = yield* makePi({...config, history: Prompt.empty})
	yield* agent.prompt(message)
	const events = yield* pipe(
		agent.events,
		Stream.takeUntil(event => !isUserMessage(event) && event.type === 'finish'),
		Stream.runCollect
	)
	const output = pipe(
		events,
		Array.filterMap(event => {
			if (isUserMessage(event) || event.type !== 'text-delta') return Result.failVoid
			return Result.succeed(event.delta)
		}),
		Array.join(''),
		String.trim
	)
	if (String.isNonEmpty(output)) return output
	return yield* ServiceAiError.make({message: 'The model returned no text'})
})
