import {Array, Option, String, pipe} from 'effect'

import type {McpSchema} from 'effect/ai'

import type {ServerIcon} from '#contracts'

import {OAuthClientId} from '#server/connections/schema.ts'

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

export function serverName(url: string) {
	return pipe(
		new URL(url).hostname,
		String.replace(/^(?:api|app|mcp)\./u, ''),
		String.split('.'),
		Array.headNonEmpty,
		// No underscores: the first `__` in a tool's name must end its server id.
		String.replaceAll(/[^a-z0-9-]/giu, '-'),
		String.replaceAll(/^[^a-z0-9]+|[^a-z0-9]+$/giu, ''),
		String.slice(0, 16),
		String.toLowerCase
	)
}
