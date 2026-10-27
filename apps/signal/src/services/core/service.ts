import {OpenRouterClient, OpenRouterLanguageModel} from '@effect/ai-openrouter'

import {
	Array,
	Boolean,
	Config,
	Context,
	Effect,
	Layer,
	Option,
	Order,
	Record,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {toCodecOpenAI} from 'effect/ai/OpenAiStructuredOutput'

import {EncounterResponse, Plan, RaidResponse} from '#services/core/schema.ts'
import type {Draft, ModelId} from '#services/core/schema.ts'
import {STATS} from '#services/game/lib/utils.ts'
import type {CoreStatus} from '#services/game/schema.ts'
import {GameError} from '#services/game/schema.ts'

const PLANNER: ModelId = 'deepseek/deepseek-v4.1-flash-1017'
const DECIDER: ModelId = 'typesafe/jev-router'
// The answer's string so far in a partial JSON plan; a trailing unfinished escape is left for the next chunk.
const ANSWER = /"answer"\s*:\s*"((?:[^"\\]|\\[^u]|\\u[\da-f]{4})*)/iu

const RAID = `Glitch raiders just hit a hauler route. Pick the response that keeps the most ore flowing for the fewest losses.
- escort: send idle or patrolling guards to escort the raided haulers.
- reroute: abandon this route and send the miners to ore farther from the raided spot.
- hold: the route is still worth it and already protected; change nothing.`

const ENCOUNTER = `Our drones just met drones of another player whose intent is unknown. Pick the safest useful response.
- watch: have a scout track them to learn where their base is.
- avoid: pull nearby workers back to the base.
- ignore: they are far from anything valuable; carry on.`

const INSTRUCTIONS = `You are CORE, the supervisor of one player's drone fleet in Signal, a hard multiplayer strategy game on an infinite procedural map. The player types one sentence; you answer in one short line, then give the fewest typed orders that do it.

# Game
- Drones: scout (fast, wide sight, explores), miner (a walking robot; mines known deposits: ore, crystal seams in high ground worth 3×, scrap in ruins and wrecks worth 2×), hauler (a hover-truck carrying ore from miners to the base; glitch raids hunt haulers), guard (armed), builder (builds turret, wall, relay with base ore).
- Costs in ore: ${Array.join(
	Array.map(
		Array.filter(Record.toEntries(STATS), entry => entry[1].cost > 0),
		entry => `${entry[0]} ${entry[1].cost}`
	),
	', '
)}.
- The team only knows what its drones have seen. Never invent coordinates: use only the base, structures, drone positions, memory entries, the farthest explored points and coordinates the player gives. For a direction ("north"), Goto the farthest explored point that way; scouts on Explore push it outward.
- Players are named by GitHub login. Search sends scouts looking at random; Track follows a player the team has sighted.

# Orders
- Assign: give drones a routine. selector must set ids, group or kind (an empty selector is refused), and count limits how many. group renames the selected drones into a group.
  Routines: Idle, Return (to base), Goto {target}, Explore, Search {player}, Track {player}, Mine, Haul, Escort {group: the group whose haulers to protect}, Patrol {center, radius}, Build {structure, at}.
- Fabricate {kind, count}: build drones at the base if ore allows.
- Remember: save a fact the live state cannot tell later. With player and stance it records a hostile or friendly standing (hostile players are attacked on sight); with name and at it saves a place; otherwise a note. Never remember drone positions, health or routines: the live state already has them.
- Forget {key}: drop a memory entry by its key.
- Relocate {target}: move the base to a known location (costs 100 ore).

# Answer
answer: one plain sentence for the player, what you do or why you cannot. Write it before the orders. No orders when the request is a question or impossible.`

const structured = toCodecOpenAI(Plan)

function answerOf(text: string) {
	return pipe(
		String.match(ANSWER)(text),
		Option.flatMapNullishOr(match => match[1]),
		Option.flatMap(raw => Schema.decodeOption(Schema.fromJsonString(Schema.String))(`"${raw}"`)),
		Option.getOrElse(() => '')
	)
}

function unreachable(cause: unknown) {
	if (Schema.is(GameError)(cause)) return cause
	return GameError.make({
		cause: Redacted.make(cause),
		message: 'CORE could not reach its model; routines keep running.'
	})
}

type Request = {autonomous: boolean; context: string; text: string}

export class Core extends Context.Service<
	Core,
	{
		readonly plan: (input: Request) => Stream.Stream<Draft, GameError>
		readonly raid: (context: string, event: string) => Effect.Effect<RaidResponse, GameError>
		readonly encounter: (context: string, event: string) => Effect.Effect<EncounterResponse, GameError>
		readonly status: (idleHours: number) => Effect.Effect<CoreStatus>
	}
>()('@deslop/signal/services/core/service/Core') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const key = yield* Config.option(Config.Redacted('OPENROUTER_API_KEY'))
			const client = yield* OpenRouterClient.make({apiKey: Option.getOrUndefined(key), siteTitle: 'Signal'})
			const decider = yield* pipe(
				OpenRouterLanguageModel.make({config: {max_tokens: 2000}, model: DECIDER}),
				Effect.provideService(OpenRouterClient.OpenRouterClient, client)
			)

			// The key's own spending cap is the budget: OpenRouter refuses calls past it.
			const available = Effect.gen(function* () {
				if (Option.isNone(key)) {
					return yield* GameError.make({message: 'CORE is offline: the server has no OpenRouter key.'})
				}
			})

			// Jev's routed models ignore JSON mode and answer in prose, so the decision is the first label the answer names.
			const decide = Effect.fnUntraced(function* <A extends string>(
				instructions: string,
				labels: A[],
				context: string,
				event: string
			) {
				yield* available
				const response = yield* decider.generateText({
					prompt: [
						{content: `${instructions}\n\nAnswer with exactly one word: ${Array.join(labels, ', ')}.`, role: 'system'},
						{content: `${context}\n\nEvent: ${event}`, role: 'user'}
					]
				})
				const answer = String.toLowerCase(response.text)
				const named = Array.flatMap(labels, label =>
					Option.match(String.indexOf(label)(answer), {onNone: () => [], onSome: index => [{index, label}]})
				)
				return yield* Option.match(
					Array.head(
						Array.sort(
							named,
							Order.mapInput(Order.Number, (entry: {index: number}) => entry.index)
						)
					),
					{
						onNone: () => GameError.make({message: 'CORE gave no usable answer; routines keep running.'}),
						onSome: entry => Effect.succeed(entry.label)
					}
				)
			})

			const failed = Effect.mapError(unreachable)

			return Core.of({
				encounter: Effect.fn('Core.encounter')(
					(context, event) => decide(ENCOUNTER, [...EncounterResponse.literals], context, event),
					Effect.timeout('20 seconds'),
					failed
				),
				// The plan streams as JSON under the schema; drafts carry the answer as it grows, then the decoded plan closes the stream.
				plan: input =>
					pipe(
						Stream.unwrap(
							Effect.gen(function* () {
								yield* available
								const text = yield* Ref.make('')
								const response = yield* client.createChatCompletionStream({
									frequency_penalty: 0.3,
									max_tokens: 1200,
									messages: [
										{content: INSTRUCTIONS, role: 'system'},
										{
											content: `${input.context}\n\n${Boolean.match(input.autonomous, {
												onFalse: () => 'Player',
												onTrue: () =>
													'Nobody asked you anything: these are events from the field. Act only when an event needs a response the routines will not give (losses on a raided route, a hostile player near workers, idle drones with nothing to do). Otherwise give no orders and keep the answer under 12 words'
											})}: ${input.text}`,
											role: 'user'
										}
									],
									model: PLANNER,
									// Some DeepSeek hosts accept JSON mode but ignore the schema; only hosts that enforce it get the request.
									provider: {require_parameters: true},
									response_format: {
										json_schema: {name: 'plan', schema: structured.jsonSchema, strict: true},
										type: 'json_schema'
									}
								})
								return pipe(
									response[1],
									Stream.timeout('45 seconds'),
									Stream.mapEffect(chunk =>
										Ref.updateAndGet(text, sofar =>
											Option.match(
												Option.flatMapNullishOr(Array.head(chunk.choices), choice => choice.delta.content),
												{onNone: () => sofar, onSome: delta => sofar + delta}
											)
										)
									),
									Stream.map(answerOf),
									Stream.filter(String.isNonEmpty),
									Stream.changes,
									Stream.map(answer => ({answer, plan: Option.none()}) satisfies Draft),
									Stream.concat(
										Stream.fromEffect(
											Effect.map(
												Effect.flatMap(
													Ref.get(text),
													Schema.decodeUnknownEffect(Schema.fromJsonString(structured.codec))
												),
												plan => ({answer: plan.answer, plan: Option.some(plan)}) satisfies Draft
											)
										)
									)
								)
							})
						),
						Stream.mapError(unreachable),
						Stream.withSpan('Core.plan')
					),
				raid: Effect.fn('Core.raid')(
					(context, event) => decide(RAID, [...RaidResponse.literals], context, event),
					Effect.timeout('20 seconds'),
					failed
				),
				// The planner slows as the team goes quiet: its autonomy interval doubles every 12 idle hours and stops at 72.
				status: Effect.fn('Core.status')(function* (idleHours) {
					if (Option.isNone(key)) return {planner: 'offline' as const}
					if (idleHours >= 72) return {planner: 'asleep' as const}
					if (idleHours >= 1) return {planner: 'slowed' as const}
					return {planner: 'ready' as const}
				})
			})
		})
	)
}
