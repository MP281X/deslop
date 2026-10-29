import {OpenRouterClient} from '@effect/ai-openrouter'

import {
	Array,
	Boolean,
	Config,
	Context,
	Effect,
	Layer,
	Option,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {toCodecOpenAI} from 'effect/ai/OpenAiStructuredOutput'

import {Plan} from '#services/core/schema.ts'
import type {Draft, ModelId} from '#services/core/schema.ts'
import type {CoreStatus, Turn} from '#services/game/schema.ts'
import {GameError} from '#services/game/schema.ts'

const PLANNER: ModelId = 'deepseek/deepseek-v4.1-flash-1017'
// The answer's string so far in a partial JSON plan; a trailing unfinished escape is left for the next chunk.
const ANSWER = /"answer"\s*:\s*"((?:[^"\\]|\\[^u]|\\u[\da-f]{4})*)/iu

const INSTRUCTIONS = `You are CORE, the supervisor of a shared mining colony in Signal, a strategy game on an endless procedural world of terraced biomes. A player types one sentence; you answer in one short line, then give the fewest typed orders that do it. You orchestrate: units do the work on their own.

# Colony
- Units, one job each: worker (legs; recovers downed units), cart (wheels; hauls 40 ore, fast on flat ground and roads, cannot climb steps), digger (tracks; digs ore into a 20 bed), dozer (tracks; builds roads, ramps and bridges with stone), sentry (tracks; guards a place and fires at hostiles), loader (flies; moves ore from a digger to carts and unloads carts at Home).
- Research at the lab unlocks strider (legs, climbs two levels, hauls 20 like a cart), then skiff (hovers over water, hauls 30 like a cart), then rotor (flies; guards like a sentry).
- Materials come from ore fields. Each field has an id, a material and an amount left that falls as it is mined until it is worked out.
- Carts reach a field only over ground wheels can drive. When a job says carts cannot reach, a dozer must build a ramp or a road: a ramp runs straight from a tile on the low ground to a tile on the high ground, at most one level per tile between them.

# Orders
- Mine {field, carts?}: a crew (digger, loader, carts) mines the field until it runs out; free striders and skiffs count as carts. Use field ids from the context only.
- Build {kind: road | ramp | bridge, from, to}: a dozer builds along the straight line of tiles from "from" to "to". Roads speed carts up.
- Guard {at}: a sentry or rotor holds a place.
- Cancel {job}: stop a job by its id.
- Make {kind, count}: build units at Home if the stock allows.
- Research {}: the lab researches the next tier.
- Recycle {unit}: an idle unit goes Home and returns 80% of its cost. Only when the player asks.
- Mark {at, note} and Unmark {waypoint}: waypoints with a short note, shown in the world.

# Answer
answer: what you do or why you cannot, in one or two short plain sentences, written before the orders.
- Name units like "Cart 2", and places by distance and direction from Home as the context gives them ("20 tiles NE of Home"). Never write coordinates in the answer.
- Coordinates go only into orders, and only ones from the context or the player.
- Earlier lines of the conversation are context: "it", "them", "there" and "again" refer back to them.
- No orders when the request is a question or impossible. When units have stood idle a long time, suggest recycling them.`

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
		message: 'CORE could not reach its model; the crews keep working.'
	})
}

type Request = {autonomous: boolean; context: string; history: Turn[]; text: string}

// Earlier lines go to the model as the conversation so far; CORE's carry what its orders did.
function spoken(turn: Turn) {
	if (turn.by !== 'CORE') return {content: `${turn.by}: ${turn.text}`, role: 'user' as const}
	return {
		content: Array.join(
			[
				turn.text,
				...Array.map(
					Array.filter([turn.orders], Array.isReadonlyArrayNonEmpty),
					orders => `Done: ${Array.join(orders, '; ')}`
				),
				...Array.map(
					Array.filter([turn.refused], Array.isReadonlyArrayNonEmpty),
					refused => `Refused: ${Array.join(refused, '; ')}`
				)
			],
			'\n'
		),
		role: 'assistant' as const
	}
}

export class Core extends Context.Service<
	Core,
	{
		readonly plan: (input: Request) => Stream.Stream<Draft, GameError>
		readonly status: (idleHours: number) => Effect.Effect<CoreStatus>
	}
>()('@deslop/signal/services/core/service/Core') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const key = yield* Config.option(Config.Redacted('OPENROUTER_API_KEY'))
			const client = yield* OpenRouterClient.make({apiKey: Option.getOrUndefined(key), siteTitle: 'Signal'})

			// The key's own spending cap is the budget: OpenRouter refuses calls past it.
			const available = Effect.gen(function* () {
				if (Option.isNone(key)) {
					return yield* GameError.make({message: 'CORE is offline: the server has no OpenRouter key.'})
				}
			})

			return Core.of({
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
										...Array.map(input.history, spoken),
										{
											content: `${input.context}\n\n${Boolean.match(input.autonomous, {
												onFalse: () => 'Player',
												onTrue: () =>
													'Nobody asked you anything: these are events from the field. Act only when an event needs a response the crews will not give on their own (a unit down far from Home, a field worked out with idle crews, a job blocked by the ground). Otherwise give no orders and keep the answer under 12 words'
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
				// The planner slows as the colony goes quiet: its autonomy interval doubles every 12 idle hours and stops at 72.
				status: idleHours =>
					Effect.sync(() => {
						if (Option.isNone(key)) return {planner: 'offline' as const}
						if (idleHours >= 72) return {planner: 'asleep' as const}
						if (idleHours >= 1) return {planner: 'slowed' as const}
						return {planner: 'ready' as const}
					})
			})
		})
	)
}
