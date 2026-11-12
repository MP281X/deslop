import {Array, HashSet, Option, Predicate, Record, Struct, Tuple, pipe} from 'effect'

import type {Tool} from '@modelcontextprotocol/client'
import type {McpSchema} from 'effect/ai'

import type {Connection} from '#services/connections/schema.ts'

export function indexTools(tools: readonly Tool[]) {
	return pipe(
		tools,
		Array.groupBy(tool => tool.name),
		Record.map(Array.headNonEmpty)
	)
}

export function prunedTools(
	definitions: readonly Connection[],
	installed: Record<string, {id: string; generation: string}>
) {
	const connected = HashSet.fromIterable(
		Array.map(
			Array.filter(definitions, server => server.link._tag !== 'Disconnected'),
			server => Tuple.make(server.id, server.generation)
		)
	)
	return Array.map(
		Array.filter(
			Record.toEntries(installed),
			entry => !HashSet.has(connected, Tuple.make(entry[1].id, entry[1].generation))
		),
		entry => entry[0]
	)
}

// Bounds that only restate a JSON number's range tell an agent nothing.
function quiet(property: Readonly<Record<string, unknown>> | boolean) {
	if (Predicate.isBoolean(property)) return property
	return Record.filter(
		property,
		(value, key) =>
			!(
				(key === 'maximum' || key === 'minimum') &&
				Predicate.isNumber(value) &&
				Math.abs(value) >= 9_007_199_254_740_991
			)
	)
}

export function compact(tool: McpSchema.Tool) {
	return Struct.evolve(tool, {
		inputSchema: inputSchema => ({
			...Record.filter(
				inputSchema,
				(value, key) => !(key === 'additionalProperties' && value === true) && key !== '$schema'
			),
			type: 'object' as const,
			...Option.match(Option.fromUndefinedOr(inputSchema.properties), {
				onNone: () => ({}),
				onSome: properties => ({properties: Record.map(properties, quiet)})
			})
		})
	})
}
