import {OpenRouterClient, OpenRouterDecisionModel} from '@effect/ai-openrouter'
import type {ChatUsage} from '@effect/ai-openrouter/Generated'

import {
	Array,
	Boolean,
	Config,
	Context,
	Effect,
	Function,
	Layer,
	Number,
	Option,
	Predicate,
	Record,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Decision} from 'effect/ai'
import {toCodecOpenAI} from 'effect/ai/OpenAiStructuredOutput'
import {KeyValueStore} from 'effect/persistence'

import {Conversation, Turn} from '#services/core/schema.ts'
import type {LocalChoice, Thought} from '#services/core/schema.ts'
import {TEAMS} from '#services/game/lib/utils.ts'
import {Command, GameError, LocalDecision} from '#services/game/schema.ts'
import type {Usage} from '#services/game/schema.ts'

const TOOLS: Record<Command['_tag'], string> = {
	Advance: 'Pay the next technology milestone from its local storage.',
	Build:
		'Plan a construction site on remembered ground. Independent Builders must supply and build it. A structure can be planned in a straight line using to.',
	Cancel: 'Cancel a construction plan or dismantle a local building.',
	Catalog: 'Look up the production rules you need instead of requesting the whole catalogue every turn.',
	Craft: 'Queue a bench_ recipe at the Core using its local stock.',
	Inspect: 'Open storage within the Core sight. Remote storage needs an individual to inspect it and report.',
	Make: 'Queue a new independent unit at the Core using its local stock.',
	Message: 'Send a message to a known communication address. ids can disclose other known addresses.',
	Order:
		'Transmit a standing objective to individuals in radio coverage. facts selects known observation IDs to forward with it. Reading and acceptance remain voluntary. Deposit carries existing cargo to storage; Repair visits a remembered downed unit.',
	Ping: 'Request a radio position in coverage. Even an incapacitated unit can answer; a position says nothing about its health.',
	Recall: 'Retrieve original archived conversation turns before a sequence number recorded in a compaction.',
	Recipe: 'Request a production recipe for a machine.',
	Tell: 'Transmit information to selected individuals in coverage. facts selects known observations and ids selects known communication addresses. Delivery is not reading or compliance.',
	Upgrade: 'Request a unit refit at the Core.'
}

const INSTRUCTIONS = `You are the physical Core coordinating a factory settlement in Signal. Develop industry, sustain the settlement, explore for finite resources and choose your long-term strategy. There is no human issuing orders to you.
You are not omniscient. You know only your local observations, received reports, remembered experience and explicit radio pings. Inventories, locations and claims can be stale. Missing replies do not prove death. Your units are independent; selectively send objectives and useful information rather than micromanaging every operation. A delivered message may remain unread. A unit may leave radio coverage without reporting.
Objects and unfamiliar creatures have no guaranteed friendly or hostile status. Infer intent from observed behaviour, preserve uncertainty and decide how to act. Containers have no ownership protection: any physically present individual can take their contents. No social agreement prevents theft, deception, attack or friendly fire. This describes physical rules, not evidence that any particular stranger exists.
Use Catalog when you need costs, recipes, units, structures or milestones. Coordinates are tiles: x east, z south. Builders gather wood/stone/ore, haul and construct. Machines require inputs, output room and, where specified, power; fluids travel in pipes. Standing objectives persist without repeated calls. Home is your local Core workshop and unit line. Expansion needs radio infrastructure if you want contact.
Use few meaningful tool calls. Do not repeatedly inspect unchanged state or repeat an objective already delivered. Explain consequential decisions concisely. Continue your persistent conversation; compaction retains your experience, not a separate notes system.`

const CODECS = Record.map(Command.cases, member => {
	const fields = Struct.omit(member.fields, ['_tag'])
	if (Array.isArrayEmpty(Record.keys(fields))) {
		return {
			codec: Schema.Struct({}),
			jsonSchema: {additionalProperties: false, properties: {}, required: [], type: 'object'}
		}
	}
	return toCodecOpenAI(Schema.Struct(fields))
})
const FUNCTIONS = Array.map(Record.toEntries(CODECS), entry => ({
	function: {description: TOOLS[entry[0]], name: entry[0], parameters: entry[1].jsonSchema, strict: true},
	type: 'function' as const
}))

function usageOf(response: ChatUsage) {
	return {
		cached: response.prompt_tokens_details?.cached_tokens,
		cost: response.cost ?? undefined,
		input: response.prompt_tokens,
		output: response.completion_tokens,
		written: response.prompt_tokens_details?.cache_write_tokens
	} satisfies Usage
}

function turnKey(seed: number, team: number | string, sequence: number) {
	return `conversation/${seed}/${team}/turn/${String.padStart(9, '0')(`${sequence}`)}`
}

export class Core extends Context.Service<
	Core,
	{
		readonly decide: (
			seed: number,
			team: number,
			observation: string,
			discovered: boolean
		) => Effect.Effect<Thought, GameError>
		readonly choose: (seed: number, request: LocalDecision) => Effect.Effect<LocalChoice, GameError>
		readonly recall: (seed: number, team: number, before: number, offset?: number) => Effect.Effect<string, GameError>
	}
>()('@deslop/signal/services/core/service/Core') {
	static readonly layer = pipe(
		Layer.effect(
			this,
			Effect.gen(function* () {
				const client = yield* OpenRouterClient.OpenRouterClient
				const decider = yield* OpenRouterDecisionModel.make({model: 'typesafe/jev-1.14'})
				const kv = yield* KeyValueStore.KeyValueStore
				const conversations = KeyValueStore.toSchemaStore(kv, Conversation)
				const turns = KeyValueStore.toSchemaStore(kv, Turn)
				const contextBudget = Number.clamp(
					yield* pipe(Config.Number('SIGNAL_CONTEXT_TOKENS'), Config.withDefault(16_000)),
					{maximum: 64_000, minimum: 8000}
				)
				const mode = yield* pipe(Config.String('NODE_ENV'), Config.withDefault('development'))

				const compact = Effect.fn('Core.compact')(function* (
					key: string,
					model: string,
					session: string,
					system: string,
					previous: Conversation,
					owner = 'Core'
				) {
					const active = {...previous}
					const prefix = [
						...Array.filter([{content: `Previous checkpoint: ${active.summary}`, role: 'user' as const}], () =>
							String.isNonEmpty(active.summary)
						),
						...active.turns
					]
					const [compacted] = yield* pipe(
						client.createChatCompletion({
							max_tokens: 2000,
							messages: [
								{content: system, role: 'system'},
								...prefix,
								{
									content: `Compact only this ${owner}'s conversation into a concise continuation checkpoint. Preserve goals, commitments, instructions pending, observations and reports with their source/tick, uncertain hypotheses, entity IDs and coordinates, unresolved problems and useful discoveries. Never turn a claim into fact or silence into proof of death. Never invent outside knowledge. Use headings Goals, Evidence, Reports, Hypotheses, Pending, Next. Do not call tools or continue play.`,

									role: 'user'
								}
							],
							model,
							reasoning: {effort: 'low'},
							session_id: session
						}),
						Effect.timeout('60 seconds')
					)
					yield* Effect.annotateCurrentSpan({
						kind: 'compaction',
						mode,
						model,
						session,
						...Option.match(Option.fromUndefinedOr(compacted.usage), {onNone: () => ({}), onSome: usageOf})
					})
					const summary = Option.getOrUndefined(Array.head(compacted.choices))
					if (
						summary?.finish_reason !== 'stop' ||
						!Predicate.isString(summary?.message.content) ||
						String.isEmpty(summary.message.content)
					) {
						return yield* GameError.make({message: 'Compaction did not finish; original history was kept.'})
					}
					active.summary = `Archived through turn ${active.sequence}. Use Recall with before to retrieve older originals.\n${summary.message.content}`
					active.turns = Array.takeRight(
						active.turns,
						Boolean.match(owner === 'Core', {onFalse: () => 0, onTrue: () => 4})
					)
					active.archive = {before: active.sequence + 1, offset: 0}
					active.measured = 0
					yield* conversations.set(key, active)
					return {conversation: active, usage: compacted.usage}
				})

				return Core.of({
					choose: Effect.fn('Core.choose')(
						function* (seed: number, request: LocalDecision) {
							const owner = `individual-${request.actor}`
							const key = `conversation/${seed}/${owner}/active`
							const previous: Conversation = {
								...Option.getOrElse(yield* conversations.get(key), () => ({
									measured: 0,
									sequence: 0,
									summary: '',
									turns: []
								}))
							}
							const original = yield* Schema.encodeEffect(Schema.fromJsonString(LocalDecision))(request)
							const input: Turn = {
								content: `Tick ${request.tick}. Private experiences:\n${Array.join(
									Array.map(
										request.experience ?? [],
										entry => `[${entry.id}; tick ${entry.tick}; ${entry.kind}; (${entry.x}, ${entry.z})] ${entry.text}`
									),
									'\n'
								)}`,
								role: 'user',
								sequence: previous.sequence + 1
							}
							yield* turns.set(turnKey(seed, owner, input.sequence), {...input, content: original})
							const incoming = {...previous, sequence: input.sequence, turns: [...previous.turns, input]}
							yield* conversations.set(key, incoming)
							const system =
								'You are one independent individual. Use only your own perceptions, experiences and received claims. Preserve instructions, commitments, entity references, provenance and uncertainty. Guidance is not forced obedience. No silence or radio ping proves death. Never invent another individual’s knowledge.'
							const continuation = yield* Option.match(
								Option.liftPredicate(
									incoming,
									value =>
										value.summary.length + Number.sumAll(Array.map(value.turns, turn => turn.content.length)) > 12_000
								),
								{
									onNone: () => Effect.succeed({conversation: incoming, usage: undefined}),
									onSome: value =>
										compact(key, TEAMS[0]?.model ?? '', `signal:${mode}:${seed}:${owner}`, system, value, 'individual')
								}
							)
							const criteria = {...request.choices}
							if (continuation.conversation.archive !== undefined) {
								criteria['recall'] =
									`Retrieve your own original experience before turn ${continuation.conversation.archive.before}, characters ${continuation.conversation.archive.offset} onward. No action will be executed during retrieval.`
							}
							const context = Array.join(
								[
									continuation.conversation.summary,
									...Array.map(continuation.conversation.turns, turn => turn.content),
									request.state
								],
								'\n'
							)
							const instructions = `${system} Balance ongoing objectives, curiosity, safety, social choices and the time of day. Do not assume an unfamiliar entity is hostile. Use recall when the continuation lacks relevant older details.`
							const response = yield* pipe(
								decider.decide(
									Decision.make({
										decisions: {action: Decision.classify({criteria, instructions})},
										input: Schema.String
									}),
									{input: context}
								),
								Effect.timeout('10 seconds')
							)
							const recalled = yield* Option.match(
								Option.filter(
									Option.fromUndefinedOr(continuation.conversation.archive),
									() => response.answers.action.label === 'recall'
								),
								{
									onNone: () => Effect.succeedNone,
									onSome: cursor =>
										Effect.map(turns.get(turnKey(seed, owner, cursor.before - 1)), turn =>
											Option.map(turn, found => ({
												archive: Option.match(
													Option.liftPredicate(cursor.offset + 6000, offset => offset < found.content.length),
													{
														onNone: () => ({before: found.sequence, offset: 0}),
														onSome: offset => ({before: cursor.before, offset})
													}
												),
												content: `Original turn ${found.sequence}, characters ${cursor.offset}–${Number.min(found.content.length, cursor.offset + 6000)}:\n${String.slice(cursor.offset, cursor.offset + 6000)(found.content)}`
											}))
										)
								}
							)
							const output: Turn = {
								content: Option.match(recalled, {
									onNone: () => `Chose ${response.answers.action.label} at tick ${request.tick}.`,
									onSome: value => value.content
								}),
								role: 'assistant',
								sequence: continuation.conversation.sequence + 1
							}
							yield* turns.set(turnKey(seed, owner, output.sequence), output)
							yield* conversations.set(key, {
								...continuation.conversation,
								sequence: output.sequence,
								...Option.match(recalled, {onNone: () => ({}), onSome: value => ({archive: value.archive})}),
								turns: [...continuation.conversation.turns, output]
							})
							yield* Effect.annotateCurrentSpan({
								actor: request.actor,
								cost: response.metadata.openrouter?.cost,
								input: response.usage.inputTokens,
								kind: 'local',
								mode,
								model: response.modelId ?? 'typesafe/jev-1.14',
								output: response.usage.outputTokens,
								seed
							})
							return {
								actor: request.actor,
								choice: Boolean.match(response.answers.action.label === 'recall', {
									onFalse: () => response.answers.action.label,
									onTrue: () => 'continue'
								}),
								confidence: response.answers.action.confidence,
								context: yield* Schema.encodeEffect(Schema.fromJsonString(LocalDecision))({
									...request,
									choices: criteria,
									instructions,
									state: context
								}),
								cost: response.metadata.openrouter?.cost,
								input: response.usage.inputTokens,
								output: response.usage.outputTokens,
								tick: request.tick
							}
						},
						Effect.mapError(cause =>
							GameError.make({
								cause,
								message: 'The local decision or durable individual continuation could not complete.'
							})
						)
					),
					decide: Effect.fn('Core.decide')(
						function* (seed: number, team: number, observation: string, discovered: boolean) {
							const model = TEAMS[team]?.model ?? ''
							const key = `conversation/${seed}/${team}/active`
							const previous = {
								...Option.getOrElse(yield* conversations.get(key), () => ({
									measured: 0,
									sequence: 0,
									summary: '',
									turns: []
								}))
							}
							const session = `signal:${mode}:${seed}:core:${team}`
							const system =
								INSTRUCTIONS +
								Option.match(Option.liftPredicate(discovered, Function.identity), {
									onNone: () => '',
									onSome: () =>
										'\nYou have learned that other teams exist. Communication is available only to addresses learned through direct encounters or disclosed by known correspondents. Agreements do not prevent betrayal; judge claims and actions from evidence.'
								})

							const continuation = yield* Option.match(
								Option.liftPredicate(
									previous,
									value =>
										value.measured + observation.length / 3 > contextBudget ||
										(value.summary.length +
											system.length +
											Number.sumAll(Array.map(value.turns, turn => turn.content.length))) /
											3 >
											contextBudget
								),
								{
									onNone: () => Effect.succeed({conversation: previous, usage: undefined}),
									onSome: conversation => compact(key, model, session, system, conversation)
								}
							)

							const active = continuation.conversation
							const input: Turn = {content: observation, role: 'user', sequence: active.sequence + 1}
							const [body] = yield* pipe(
								client.createChatCompletion({
									max_tokens: 2000,
									messages: [
										{content: system, role: 'system'},
										...Array.filter([{content: active.summary, role: 'user' as const}], () =>
											String.isNonEmpty(active.summary)
										),
										...Array.map(active.turns, turn => ({content: turn.content, role: turn.role})),
										{content: input.content, role: input.role}
									],
									model,
									parallel_tool_calls: true,
									provider: {require_parameters: true},
									reasoning: {effort: 'low'},
									session_id: session,
									tool_choice: 'auto',
									tools: Array.filter(FUNCTIONS, tool => discovered || tool.function.name !== 'Message')
								}),
								Effect.timeout('89 seconds')
							)

							const usage = Option.map(Option.fromUndefinedOr(body.usage), response => ({
								...usageOf(response),
								compaction: Option.getOrUndefined(Option.map(Option.fromUndefinedOr(continuation.usage), usageOf))
							}))
							yield* Effect.annotateCurrentSpan({
								kind: 'strategy',
								mode,
								model,
								seed,
								team,
								...Option.getOrElse(usage, () => ({}))
							})
							const message = Option.getOrUndefined(Option.map(Array.head(body.choices), choice => choice.message))
							if (message === undefined) {
								return yield* GameError.make({message: 'The provider returned no Core response.'})
							}
							const decoded = Array.map(message?.tool_calls ?? [], call => ({
								call,
								command: Option.flatMap(
									Array.findFirst(Record.toEntries(CODECS), entry => entry[0] === call.function.name),
									entry =>
										Option.flatMap(
											Schema.decodeOption(Schema.fromJsonString(entry[1].codec))(call.function.arguments),
											fields => Schema.decodeUnknownOption(Command)({...fields, _tag: entry[0]})
										)
								)
							}))
							const text = Option.getOrElse(
								Option.liftPredicate(message?.content, value => Predicate.isString(value)),
								() => ''
							)
							const output: Turn = {
								content: `${text}\nRequested actions: ${Array.join(
									Array.map(decoded, entry => `${entry.call.function.name}(${entry.call.function.arguments})`),
									'\n'
								)}`,
								role: 'assistant',
								sequence: input.sequence + 1
							}
							yield* turns.set(turnKey(seed, team, input.sequence), input)
							yield* turns.set(turnKey(seed, team, output.sequence), output)
							yield* conversations.set(key, {
								measured: body.usage?.prompt_tokens ?? 0,
								sequence: output.sequence,
								summary: active.summary,
								turns: [...active.turns, input, output]
							})

							return {
								commands: Array.getSomes(Array.map(decoded, entry => entry.command)),
								invalid: Array.map(
									Array.filter(decoded, entry => Option.isNone(entry.command)),
									entry => `${entry.call.function.name}(${entry.call.function.arguments})`
								),
								reasoning: message?.reasoning ?? undefined,
								text,
								tokens: Option.getOrUndefined(usage)
							} satisfies Thought
						},
						Effect.timeout('85 seconds'),
						Effect.mapError(cause =>
							GameError.make({cause, message: 'The Core decision or durable conversation could not complete.'})
						)
					),
					recall: Effect.fn('Core.recall')(
						function* (seed: number, team: number, before: number, offset = 0) {
							return Option.match(yield* turns.get(turnKey(seed, team, before - 1)), {
								onNone: () => 'No archived turn there.',
								onSome: turn =>
									`[${turn.sequence} ${turn.role}; characters ${offset}–${Number.min(turn.content.length, offset + 6000)} of ${turn.content.length}. Earlier: Recall before=${turn.sequence}. Continue this turn: Recall before=${before}, offset=${offset + 6000}.]\n${String.slice(offset, offset + 6000)(turn.content)}`
							})
						},
						Effect.mapError(cause => GameError.make({cause, message: 'The conversation archive could not be read.'}))
					)
				})
			})
		),
		Layer.provide(
			OpenRouterClient.layerConfig({
				apiKey: pipe(Config.option(Config.Redacted('OPENROUTER_API_KEY')), Config.map(Option.getOrUndefined))
			})
		)
	)
}
