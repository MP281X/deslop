import {Option, Predicate, Record, Struct} from 'effect'

import type {McpSchema} from 'effect/ai'

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

// A tool as agents see it through the gateway: its inputs without noise, and no output schema.
export function compact(tool: McpSchema.Tool) {
	return {
		...Struct.omit(tool, ['outputSchema']),
		inputSchema: {
			...Record.filter(
				tool.inputSchema,
				(value, key) => !(key === 'additionalProperties' && value === true) && key !== '$schema'
			),
			type: 'object' as const,
			...Option.match(Option.fromUndefinedOr(tool.inputSchema.properties), {
				onNone: () => ({}),
				onSome: properties => ({properties: Record.map(properties, quiet)})
			})
		}
	}
}
