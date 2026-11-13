import {Array, Duration, Effect, Option, Predicate, Schema, String, pipe} from 'effect'

import {Client} from '@modelcontextprotocol/client'
import type {StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import type {McpSchema} from 'effect/ai'
import {HttpClientError} from 'effect/http'

import {AuthError} from '@deslop/runtime/shared/auth'

import {OAuthClientId, UpstreamError} from '#services/connections/schema.ts'
import type {ServerIcon} from '#services/connections/schema.ts'

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
		Effect.timeout(Duration.seconds(3)),
		Effect.ignore({log: 'Warn', message: `Cannot terminate the ${kind} MCP session`}),
		Effect.andThen(Effect.tryPromise({catch: fail, try: () => client.close()})),
		Effect.ignore({log: 'Warn', message: `Cannot close the ${kind} MCP client`})
	)
}

export function clientMetadata(url: string) {
	return {
		client_id: OAuthClientId.make(`${url}/oauth/client.json`),
		client_name: 'Deslop MCP gateway',
		grant_types: ['authorization_code', 'refresh_token'],
		redirect_uris: [`${url}/oauth/callback`],
		response_types: ['code'],
		token_endpoint_auth_method: 'none'
	}
}

// The icons a server names in its MCP server info, kept to a few a page can show, each small enough to stream to it.
export function serverIcons(implementation?: McpSchema.Implementation) {
	return pipe(
		implementation?.icons ?? [],
		Array.filter(
			icon => Option.isSome(String.match(/^(?:https:|data:image\/)/u)(icon.src)) && icon.src.length <= 32_768
		),
		Array.take(2),
		Array.map(icon => ({src: icon.src, theme: Option.fromUndefinedOr(icon.theme)}))
	) satisfies ServerIcon[]
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
