import {Array, HashSet, Option, Predicate, Record, Struct, Tuple, pipe} from 'effect'

import type {Tool} from '@modelcontextprotocol/client'

import type {ConnectionState} from '#services/connections/schema.ts'
import type {RemoteTool} from '#services/gateway/schema.ts'

export function indexTools(tools: readonly Tool[]) {
	return pipe(
		tools,
		Array.groupBy(tool => tool.name),
		Record.map(Array.headNonEmpty)
	)
}

export function prunedTools(
	definitions: readonly ConnectionState[],
	installed: Record<string, Pick<ConnectionState, 'id' | 'generation'>>
) {
	const connected = HashSet.fromIterable(
		pipe(
			definitions,
			Array.filter(server => server.status !== 'Not connected'),
			Array.map(server => Tuple.make(server.id, server.generation))
		)
	)
	return pipe(
		Record.toEntries(installed),
		Array.filter(entry => !HashSet.has(connected, Tuple.make(entry[1].id, entry[1].generation))),
		Array.map(entry => entry[0])
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

export function compact(tool: RemoteTool) {
	return Struct.evolve(tool, {
		inputSchema: inputSchema => ({
			...pipe(
				inputSchema,
				Struct.omit(['properties']),
				Record.filter((value, key) => !(key === 'additionalProperties' && value === true) && key !== '$schema')
			),
			type: 'object' as const,
			...Option.match(inputSchema.properties, {
				onNone: () => ({}),
				onSome: properties => ({properties: Record.map(properties, quiet)})
			})
		})
	})
}
