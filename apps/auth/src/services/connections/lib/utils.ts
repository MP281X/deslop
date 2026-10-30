import {Array, Boolean, Option, Predicate, Schema, String, pipe} from 'effect'

import {HttpClientError} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'

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
		...Option.match(Option.fromUndefinedOr(connection.error), {onNone: () => ({}), onSome: error => ({error})}),
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

// Why a provider step failed, in the words the MCP page and tool results show: the innermost cause that names it.
export function describe(cause: unknown): string {
	if (Schema.is(AuthError)(cause)) return cause.message
	if (Predicate.isTagged(cause, 'TimeoutError')) return 'It did not answer in time'
	if (HttpClientError.isHttpClientError(cause) && cause.reason._tag === 'StatusCodeError') {
		return `It answered HTTP ${cause.reason.response.status}`
	}
	if (
		Predicate.hasProperty(cause, 'cause') &&
		Predicate.isNotUndefined(cause.cause) &&
		Predicate.isTagged(cause, 'UnknownError')
	) {
		return describe(cause.cause)
	}
	if (Predicate.hasProperty(cause, 'message') && Predicate.isString(cause.message)) {
		return String.slice(0, 300)(cause.message)
	}
	return 'It failed for an unknown reason'
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
