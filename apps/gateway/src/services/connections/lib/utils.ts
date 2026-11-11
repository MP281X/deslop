import {
	Array,
	Boolean,
	Config,
	Effect,
	Match,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Client} from '@modelcontextprotocol/client'
import type {StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {HttpClientError} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'

import {UpstreamError} from '#services/connections/schema.ts'
import type {Connection, ConnectionInfo, McpUsageBucket, ServerIcon} from '#services/connections/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

export const gatewayUrl = Config.String('APP_URL')

export function mcpClient() {
	return new Client({name: 'Deslop MCP gateway', version: '0.1.0'}, {versionNegotiation: {mode: 'auto'}})
}

// A finished upstream session says goodbye within a bound, then closes; either failure only warns.
export function endSession(
	transport: Pick<StreamableHTTPClientTransport, 'terminateSession'>,
	client: Pick<Client, 'close'>,
	fail: (cause: unknown) => AuthError | UpstreamError,
	kind: 'upstream' | 'anonymous'
) {
	return pipe(
		Effect.tryPromise({catch: fail, try: () => transport.terminateSession()}),
		Effect.timeout('3 seconds'),
		Effect.ignore({log: 'Warn', message: `Cannot terminate the ${kind} MCP session`}),
		Effect.andThen(Effect.tryPromise({catch: fail, try: () => client.close()})),
		Effect.ignore({log: 'Warn', message: `Cannot close the ${kind} MCP client`})
	)
}

export function clientMetadata(url: string) {
	return {
		client_id: `${url}/oauth/client.json`,
		client_name: 'Deslop MCP gateway',
		grant_types: ['authorization_code', 'refresh_token'],
		redirect_uris: [`${url}/oauth/callback`],
		response_types: ['code'],
		token_endpoint_auth_method: 'none'
	}
}

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
		...Struct.pick(connection, ['id', 'name', 'url']),
		icons: connection.icons ?? [],
		status: connectionStatus(connection, now),
		tools: Array.length(connection.tools)
	} satisfies ConnectionInfo
}

// Usage is stored by hour; the page's day view sums each day's hours.
export function usageSeries(buckets: readonly McpUsageBucket[], range: UsageRange) {
	return pipe(
		Array.filter(buckets, bucket => bucket.at >= range.from && bucket.at < range.to),
		Array.groupBy(bucket => `${Math.floor(bucket.at / range.size) * range.size}`),
		Record.values,
		Array.map(entries => ({
			at: Math.floor(entries[0].at / range.size) * range.size,
			calls: Number.sumAll(Array.map(entries, bucket => bucket.calls))
		})),
		Array.sort(Order.mapInput(Number.Order, (entry: {at: number}) => entry.at))
	)
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

export function summary(connection: Connection) {
	return pipe(
		Option.fromUndefinedOr(connection.instructions),
		Option.flatMap(text => Option.fromUndefinedOr(String.split(text, /(?<=\.)\s/u)[0])),
		Option.map(String.slice(0, 160)),
		Option.getOrElse(() => connection.name)
	)
}

export function describe(cause: unknown): string {
	if (Schema.is(AuthError)(cause)) return cause.message
	if (Predicate.isTagged(cause, 'TimeoutError')) return 'It did not answer in time'
	if (HttpClientError.isHttpClientError(cause) && cause.reason._tag === 'StatusCodeError') {
		return `It answered HTTP ${cause.reason.response.status}`
	}
	if (Schema.is(UpstreamError)(cause)) return describe(cause.cause)
	if (Predicate.hasProperty(cause, 'message') && Predicate.isString(cause.message)) {
		return String.slice(0, 300)(cause.message)
	}
	return 'It failed for an unknown reason'
}

// A connection failure keeps its Auth error as it is; anything else becomes an outage the page can retry.
export function connectionFailure(prefix: string) {
	return (cause: unknown) => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, error: 'temporarily_unavailable', message: `${prefix}: ${describe(cause)}`})
	}
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
