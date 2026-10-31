import {Array, Boolean, Match, Option, Predicate, Schema, String, Struct, pipe} from 'effect'

import {HttpClientError} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'

import type {Connection, ConnectionInfo, ServerIcon} from '#services/connections/schema.ts'

export const GATEWAY_URL = 'https://gateway.mp281x.xyz'
// Where providers answer the gateway's sign-ins: `/<id>` for a client registered per server, bare for the metadata document.
export const CALLBACK = `${GATEWAY_URL}/oauth/callback`

// A provider token without a refresh token cannot be renewed once it expires.
export function connectionStatus(connection: Connection, now: number) {
	return Match.valueTags(connection.link, {
		Authorized: link =>
			Boolean.match(link.expiresAt <= now && link.token.refresh_token === undefined, {
				onFalse: () => 'Connected' as const,
				onTrue: () => 'Expired' as const
			}),
		Connected: () => 'Connected' as const,
		Disconnected: () => 'Not connected' as const
	})
}

export function connectionInfo(connection: Connection, now: number) {
	return {
		...Option.match(Option.fromUndefinedOr(connection.error), {onNone: () => ({}), onSome: error => ({error})}),
		...Struct.pick(connection, ['hidden', 'id', 'name', 'tools', 'url']),
		icons: connection.icons ?? [],
		status: connectionStatus(connection, now)
	} satisfies ConnectionInfo
}

// The icons a server names in its MCP server info, kept to a few a page can show, each small enough to stream to it.
export function serverIcons(implementation?: {icons?: {src: string; theme?: 'dark' | 'light'}[]}) {
	return pipe(
		implementation?.icons ?? [],
		Array.filter(
			icon => Option.isSome(String.match(/^(?:https:|data:image\/)/u)(icon.src)) && icon.src.length <= 32_768
		),
		Array.take(2),
		Array.map(icon => ({
			src: icon.src,
			...Option.match(Option.fromUndefinedOr(icon.theme), {onNone: () => ({}), onSome: theme => ({theme})})
		}))
	) satisfies ServerIcon[]
}

// A server's line in the gateway's instructions: the first sentence of its own, short.
export function summary(connection: Connection) {
	return pipe(
		Option.fromUndefinedOr(connection.instructions),
		Option.flatMap(text => Option.fromUndefinedOr(String.split(text, /(?<=\.)\s/u)[0])),
		Option.map(String.slice(0, 160)),
		Option.getOrElse(() => connection.name)
	)
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
