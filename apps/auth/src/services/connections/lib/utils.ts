import {Array, Boolean, Option, String, pipe} from 'effect'

import type {Connection, ConnectionInfo} from '#services/connections/schema.ts'

export function connectionInfo(connection: Connection, now: number) {
	const expired =
		connection.mode === 'oauth' &&
		connection.token !== undefined &&
		connection.expiresAt <= now &&
		connection.token.refresh_token === undefined
	const connected = connection.enabled && !expired && (connection.mode !== 'oauth' || connection.token !== undefined)
	return {
		connected,
		id: connection.id,
		name: connection.name,
		status: Boolean.match(connected, {
			onFalse: () =>
				Boolean.match(expired, {onFalse: () => 'Not connected' as const, onTrue: () => 'Expired' as const}),
			onTrue: () => 'Connected' as const
		}),
		...Option.match(
			Option.filter(Option.fromUndefinedOr(connection.tools), () => connected),
			{onNone: () => ({}), onSome: tools => ({tools})}
		),
		url: connection.url
	} satisfies ConnectionInfo
}

export function serverName(url: string) {
	return pipe(
		new URL(url).hostname,
		String.replace(/^(?:api|app|mcp)\./u, ''),
		String.split('.'),
		Array.headNonEmpty,
		String.replaceAll(/[^a-z0-9_-]/giu, '-'),
		String.replaceAll(/^[^a-z0-9]+|[^a-z0-9]+$/giu, ''),
		String.slice(0, 16),
		String.toLowerCase
	)
}
