import {OpenRouterClient} from '@effect/ai-openrouter'

import {Array, Config, Context, Effect, Layer, Option, Predicate, Record, Redacted, Schema, Struct, pipe} from 'effect'

import {toCodecOpenAI} from 'effect/ai/OpenAiStructuredOutput'

import type {Decision} from '#services/core/schema.ts'
import {BUILDINGS, GATES, RECIPES, ROUND, STRUCTURES, TEAMS, TICK, UNITS} from '#services/game/lib/utils.ts'
import type {Items} from '#services/game/lib/utils.ts'
import {Command, GameError, ItemId} from '#services/game/schema.ts'

// What each tool does, for the model; one tool a command.
const TOOLS: Record<Command['_tag'], string> = {
	Advance:
		'Pay the next milestone: a tier from the items in Home, a phase or Signal cycle from the items in the Beacon. Unlocks everything of that tier.',
	Build:
		'Place a construction site for a building with its north-west tile at (x, z), or lay a structure (belt, pipe, pole, road…) on every tile of the straight line from (x, z) to `to`; a single belt runs `dir`. Builders on Auto clear it, bring its items from Home or crates, and build it.',
	Cancel:
		'Drop a construction site or take a building down; what went into it goes back to Home. A built road, ramp or bridge stays.',
	Craft: "Queue a bench_ recipe on Home's bench, `count` times, made from the items in Home.",
	Make: "Queue a mark 1 unit on Home's line, made from the items in Home.",
	Message: 'Send a line to a team you have met.',
	Note: 'Replace your notes: a short plan and what you learned, shown back to you every round.',
	Order: 'Give units a standing order they keep until the next one.',
	Recipe: 'Set what a machine makes.',
	Upgrade: "Send a unit Home to be refitted a mark up; it takes the mark's items from Home."
}

function items(cost: Items) {
	return (
		Array.join(
			Array.map(
				Array.filter(ItemId.literals, item => (cost[item] ?? 0) > 0),
				item => `${cost[item] ?? 0} ${item}`
			),
			' + '
		) || 'free'
	)
}

// The rules and the whole production tree, from the progression's data.
const INSTRUCTIONS = Array.join(
	[
		`You run one team in Signal, an endless factory simulation on a shared procedural world. Every round (${(ROUND * TICK).toFixed(0)} s of game time) you read your colony and give commands with the tools; they apply at the start of the round after you answer, in the order you give them; a slow answer costs rounds. Units keep their standing orders between rounds, so give orders that last. Nobody answers you: there is no player.`,
		'',
		'# Goal',
		'Build a factory from nothing and climb the milestones: tiers paid at Home, phases at the Beacon, then Signal cycles forever. Each milestone unlocks the buildings, structures, recipes and unit marks of its tier.',
		'',
		'# How the world works',
		'- Coordinates are tiles: x grows east, z grows south. A building covers [w×d] tiles from its north-west tile; it needs explored, dry, flat enough, free ground. A miner must cover ore.',
		'- Builders gather by hand with a Gather order: ore on an ore field, wood from trees, stone from rocks or a stone field; they carry it to the nearest store (Home or a crate). Gather near the field or trees, not at Home.',
		'- Builders on Auto serve the construction sites: they clear the trees and rocks on a footprint, fetch the site’s items from Home or crates, and build it. Nothing is paid when you place a site, but its items must be in a store. With one Builder, switch it between Gather and Auto.',
		'- Haul orders move items from one building (a machine’s or miner’s output, or a store’s stock) to another (a machine takes only its recipe’s inputs, a generator its fuel, a crate anything up to its capacity, Home anything). Give `count` for a one-off transfer; without it the haul repeats for good. Builders and Haulers haul.',
		'- A machine needs a recipe (Recipe) and its inputs brought; it puts its output in a 40-item buffer that must be taken away. A furnace burns its fuel as an ingredient. Miners dig the field under them.',
		'- Machines that draw power (MW above 0) run only on a network: a pole wires to poles within 6 tiles and powers machines within 2 tiles of it (a pylon 16 and 4); generators on the network burn the fuel hauled to them. A short supply slows every machine on it.',
		'- A belt carries items one tile at a time in its direction at its rate; a belt starting beside a machine or miner (running away from it) takes its output, and a belt pointing into a building puts items in. Fluids move only in pipes from pumps on water.',
		"- Home's bench makes bench_ recipes (Craft); Home's line makes units (Make) and refits them (Upgrade). Both take their items from Home when they start.",
		'- Hostiles raid units far from Home once your team has paid a tier. Home’s gun covers 9 tiles round it; Guards fight; hurt units go Home to be repaired; a Builder repairs a unit that is down.',
		'- Other teams build somewhere far off on the same world. You learn of one only when your units see its units or buildings; then you may message it. What you do with them is up to you.',
		'- Keep a short plan in your notes (Note): it is shown back to you every round.',
		'',
		'# Each round',
		'Read the notices and last round’s results (a refused command says why), then act. Give few, decisive commands; never repeat an order a unit already has. Ids are the #numbers in your colony.',
		'',
		'# Units (class: marks; cargo, speed in tiles/s, the items each mark costs, its tier)',
		...Array.map(
			Record.toEntries(UNITS),
			entry =>
				`- ${entry[0]}: ${entry[1].job}. ${Array.join(
					Array.map(
						entry[1].marks,
						(mark, index) => `mk${index + 1} cargo ${mark.cargo} speed ${mark.speed} ${items(mark.cost)} (${mark.tier})`
					),
					'; '
				)}`
		),
		'',
		'# Buildings (size, MW, cost, tier)',
		...Array.map(
			Record.toEntries(BUILDINGS),
			entry =>
				`- ${entry[0]}: ${entry[1].size[0]}×${entry[1].size[1]}, ${entry[1].mw} MW, ${items(entry[1].cost)} (${entry[1].tier}). ${entry[1].note}`
		),
		'',
		'# Structures (per tile)',
		...Array.map(
			Record.toEntries(STRUCTURES),
			entry => `- ${entry[0]}: ${items(entry[1].cost)} (${entry[1].tier}). ${entry[1].note}`
		),
		'',
		'# Recipes (building: inputs → outputs, seconds, tier)',
		...Array.map(
			Record.toEntries(RECIPES),
			entry =>
				`- ${entry[0]} in ${entry[1].building}: ${items(entry[1].inputs)} → ${items(entry[1].outputs)}, ${entry[1].seconds} s (${entry[1].tier})`
		),
		'',
		'# Milestones in order (paid at, cost, first needs)',
		...Array.map(
			Record.toEntries(GATES),
			entry => `- ${entry[0]} ${entry[1].name}: at ${entry[1].at}, ${items(entry[1].cost)}, after ${entry[1].needs}`
		)
	],
	'\n'
)

// A command without arguments, as a tool: OpenAI's codec takes an empty struct for any value at all, which strict tools refuse.
const NO_ARGUMENTS = {
	codec: Schema.Struct({}),
	jsonSchema: {additionalProperties: false, properties: {}, required: [], type: 'object'}
}

// One tool a command: its arguments are the command's fields, as strict JSON schema.
const CODECS = Record.map(Command.cases, member => {
	const fields = Struct.omit(member.fields, ['_tag'])
	if (Array.isReadonlyArrayEmpty(Record.keys(fields))) return NO_ARGUMENTS
	return toCodecOpenAI(Schema.Struct(fields))
})
const FUNCTIONS = Array.map(Record.toEntries(CODECS), entry => ({
	function: {description: TOOLS[entry[0]], name: entry[0], parameters: entry[1].jsonSchema, strict: true},
	type: 'function' as const
}))

// A tool call as the command it names, if its arguments decode.
function decodeCall(name: string, json: string) {
	return Option.flatMap(
		Array.findFirst(Record.toEntries(CODECS), entry => entry[0] === name),
		entry =>
			Option.flatMap(Schema.decodeOption(Schema.fromJsonString(entry[1].codec))(json), fields =>
				Schema.decodeUnknownOption(Command)({...fields, _tag: entry[0]})
			)
	)
}

function textOf(content: unknown) {
	if (Predicate.isString(content)) return content
	return ''
}

export class Core extends Context.Service<
	Core,
	{
		// One round of a team's model: it reads the observation and answers with tool calls.
		readonly decide: (team: number, observation: string) => Effect.Effect<Decision, GameError>
	}
>()('@deslop/signal/services/core/service/Core') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const key = yield* Config.option(Config.Redacted('OPENROUTER_API_KEY'))
			const client = yield* OpenRouterClient.make({apiKey: Option.getOrUndefined(key), siteTitle: 'Signal'})

			return Core.of({
				decide: Effect.fn('Core.decide')(function* (team: number, observation: string) {
					if (Option.isNone(key)) return yield* GameError.make({message: 'No OpenRouter key: the teams cannot think.'})
					const model = TEAMS[team]?.model ?? ''
					yield* Effect.annotateCurrentSpan({model, team})
					const [body] = yield* pipe(
						client.createChatCompletion({
							max_tokens: 6000,
							messages: [
								{content: INSTRUCTIONS, role: 'system'},
								{content: observation, role: 'user'}
							],
							model,
							parallel_tool_calls: true,
							provider: {require_parameters: true},
							reasoning: {effort: 'low'},
							tool_choice: 'auto',
							tools: FUNCTIONS
						}),
						// The answer applies at the first round's end after it comes; the game waits three rounds, 90 s, for it.
						Effect.timeout('89 seconds'),
						Effect.mapError(cause =>
							GameError.make({cause: Redacted.make(cause), message: `${model} did not answer: ${cause.message}`})
						)
					)
					const message = Option.getOrUndefined(Option.map(Array.head(body.choices), choice => choice.message))
					const decoded = Array.map(message?.tool_calls ?? [], call => ({
						call,
						command: decodeCall(call.function.name, call.function.arguments)
					}))
					return {
						commands: Array.getSomes(Array.map(decoded, entry => entry.command)),
						invalid: Array.map(
							Array.filter(decoded, entry => Option.isNone(entry.command)),
							entry => `${entry.call.function.name}(${entry.call.function.arguments})`
						),
						reasoning: message?.reasoning ?? undefined,
						text: textOf(message?.content),
						tokens: Option.getOrUndefined(
							Option.map(Option.fromUndefinedOr(body.usage), usage => ({
								input: usage.prompt_tokens,
								output: usage.completion_tokens
							}))
						)
					} satisfies Decision
				})
			})
		})
	)
}
