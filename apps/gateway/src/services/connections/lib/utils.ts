import {Array, Boolean, Duration, Effect, Option, Predicate, Schema, String, pipe} from 'effect'

import {Client, SdkHttpError, UnauthorizedError} from '@modelcontextprotocol/client'
import type {StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import type {McpSchema} from 'effect/ai'
import {McpClientError} from 'effect/ai'
import {HttpClientError} from 'effect/http'

import {AuthError} from '@deslop/runtime/shared/auth'

import {FailureReason, OAuthClientId, failureMessage} from '#services/connections/schema.ts'
import type {SessionKind, ServerIcon, UpstreamError} from '#services/connections/schema.ts'

export function mcpClient() {
	return new Client({name: 'Deslop MCP gateway', version: '0.1.0'}, {versionNegotiation: {mode: 'auto'}})
}

// A finished upstream session says goodbye within a bound, then closes; either failure only warns.
export function endSession(
	transport: Pick<StreamableHTTPClientTransport, 'terminateSession'>,
	client: Pick<Client, 'close'>,
	fail: (cause: unknown) => AuthError | UpstreamError,
	kind: SessionKind
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
export function serverIcons(implementation: Option.Option<McpSchema.Implementation>) {
	return pipe(
		implementation,
		Option.toArray,
		Array.flatMap(server => server.icons ?? []),
		Array.filter(
			icon => Option.isSome(String.match(/^(?:https:|data:image\/)/u)(icon.src)) && icon.src.length <= 32_768
		),
		Array.take(2),
		Array.map(icon => ({src: icon.src, theme: Option.fromUndefinedOr(icon.theme)}))
	) satisfies ServerIcon[]
}

export function describe(cause: unknown, depth = 0): FailureReason {
	if (depth >= 8) return FailureReason.cases.Unknown.make({})
	if (Predicate.isTagged(cause, 'TimeoutError')) return FailureReason.cases.Timeout.make({})
	if (cause instanceof SdkHttpError) return FailureReason.cases.HttpStatus.make({code: cause.status})
	if (cause instanceof UnauthorizedError) return FailureReason.cases.Unauthorized.make({})
	if (HttpClientError.isHttpClientError(cause) && cause.reason instanceof HttpClientError.StatusCodeError) {
		return FailureReason.cases.HttpStatus.make({code: cause.reason.response.status})
	}
	if (McpClientError.isMcpClientError(cause) && Schema.is(McpClientError.HttpError)(cause.reason)) {
		return FailureReason.cases.HttpStatus.make({code: cause.reason.status})
	}
	if (Predicate.isError(cause) && cause.cause !== undefined) return describe(cause.cause, depth + 1)
	if (Schema.is(AuthError)(cause)) {
		return Boolean.match(cause.error === 'temporarily_unavailable', {
			onFalse: () => FailureReason.cases.Unauthorized.make({}),
			onTrue: () => FailureReason.cases.Unavailable.make({})
		})
	}
	if (Predicate.hasProperty(cause, 'code') && cause.code === 'ECONNREFUSED') return FailureReason.cases.Refused.make({})
	return FailureReason.cases.Unknown.make({})
}

// Only fixed failure labels cross the boundary, including the serialized error's optional cause.
export function connectionFailure(prefix: string) {
	return (cause: unknown) => {
		const message = `${prefix}: ${failureMessage(describe(cause))}`
		if (Schema.is(AuthError)(cause)) {
			if (cause.error === undefined) return AuthError.make({message})
			return AuthError.make({error: cause.error, message})
		}
		return AuthError.make({error: 'temporarily_unavailable', message})
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
