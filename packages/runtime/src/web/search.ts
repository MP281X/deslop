import {Record, Schema} from 'effect'

// TanStack serializes both raw parsed search and validated search. Only the latter needs the Struct's wire encoding.
export function searchSerializerOf(
	schema: Schema.ConstraintCodec<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>> & {
		readonly fields: Schema.Struct.Fields
	},
	stringify: (search: Record<string, unknown>) => string
) {
	return (search: Record<string, unknown>) => {
		if (!Schema.is(schema)(search)) return stringify(search)
		const encoded = Schema.encodeSync(schema)(search)
		return stringify({
			...Record.filter(search, (_, key) => !Record.has(schema.fields, key) || Record.has(encoded, key)),
			...encoded
		})
	}
}
