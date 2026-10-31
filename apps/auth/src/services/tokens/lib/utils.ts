import {Array, Effect, Option, Record, Result, Schema, String, pipe} from 'effect'

import {Base64Url} from 'effect/encoding'
import {Url} from 'effect/http'
import ipaddr from 'ipaddr.js'

import {AuthError, Resource} from '@deslop/runtime/auth/schema'
import {AUTH_URL, previewOrigin} from '@deslop/runtime/auth/utils'

import type {AuthorizeClient, AuthorizeParams, Origin} from '#services/tokens/schema.ts'
import {ClientInfo, ClientRequest} from '#services/tokens/schema.ts'

// The workers by their public and tailnet addresses; Traefik runs on dev, so dev's own requests may also arrive from a private one.
const WORKERS: Record<string, string> = {
	'77.237.236.132': 'dev',
	'100.68.201.107': 'dev',
	'100.97.120.3': 'desktop',
	'100.115.207.60': 'macbook-pro'
}
const LOCAL_RANGES = ['linkLocal', 'loopback', 'private', 'uniqueLocal']

// Whoever holds an IPv6 address holds its whole /64, so limits count the /64.
export function addressGroup(address: string) {
	if (!ipaddr.isValid(address)) return address
	const parsed = ipaddr.process(address)
	if (parsed.kind() === 'ipv4') return parsed.toString()
	return Array.join(Array.take(String.split(parsed.toNormalizedString(), ':'), 4), ':')
}

// A client id is its registration, encoded: anyone may register, and the callbacks are checked again at authorize.
export function clientIdOf(client: ClientInfo) {
	return Base64Url.encode(Schema.encodeSync(Schema.fromJsonString(ClientInfo))(client))
}

// "Claude Code (auth)" reads Claude Code, "codex" Codex: the app, as the signed-in list names it.
export function clientLabel(name: string) {
	return pipe(name, String.replace(/\s*\([^)]*\)$/u, ''), String.trim, String.capitalize)
}

function platform(userAgent: string) {
	if (String.includes('iPhone')(userAgent)) return Option.some('iPhone')
	if (String.includes('iPad')(userAgent)) return Option.some('iPad')
	if (String.includes('Android')(userAgent)) return Option.some('Android')
	if (String.includes('Macintosh')(userAgent)) return Option.some('Mac')
	if (String.includes('Windows')(userAgent)) return Option.some('Windows')
	if (String.includes('Linux')(userAgent)) return Option.some('Linux')
	return Option.none()
}

// A browser as GitHub and Google list it: its name from the User-Agent.
export function browserLabel(origin: Origin) {
	const agent = origin.userAgent ?? ''
	if (String.includes('Edg/')(agent)) return 'Edge'
	if (String.includes('Firefox/')(agent)) return 'Firefox'
	if (String.includes('Chrome/')(agent)) return 'Chrome'
	if (String.includes('Safari/')(agent)) return 'Safari'
	return 'Browser'
}

// Where a sign-in runs: a worker preview's host, a known worker, the platform its User-Agent names, or its address.
export function deviceLabel(origin: Origin, redirectUri: Option.Option<string>) {
	return pipe(
		Option.flatMap(redirectUri, previewOrigin),
		Option.map(preview => pipe(new URL(preview), url => `${String.split(url.hostname, '.')[0] ?? ''}:${url.port}`)),
		Option.orElse(() =>
			Option.flatMap(Option.fromUndefinedOr(origin.address), address => {
				if (ipaddr.isValid(address) && Array.contains(LOCAL_RANGES, ipaddr.process(address).range())) {
					return Option.some('dev')
				}
				return Record.get(WORKERS, address)
			})
		),
		Option.orElse(() => Option.flatMap(Option.fromUndefinedOr(origin.userAgent), platform)),
		Option.getOrElse(() => origin.address ?? 'unknown')
	)
}

function loopback(redirect: string) {
	return Option.filter(
		Result.getSuccess(Url.fromString(redirect)),
		target =>
			target.protocol === 'http:' &&
			Array.contains(['127.0.0.1', '[::1]', 'localhost'], target.hostname) &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password) &&
			String.isEmpty(target.search) &&
			String.isEmpty(target.hash)
	)
}

// The iOS apps in their release and Simulator builds, a loopback callback of a desktop agent, or the gateway's callback for one of its servers.
export function allowedRedirect(redirect: string) {
	return (
		Option.isSome(
			String.match(/^https:\/\/gateway\.mp281x\.xyz\/oauth\/callback\/[a-z0-9][a-z0-9_-]{0,23}$/u)(redirect)
		) ||
		Array.contains(
			[
				'stash://auth/callback',
				'stash-dev://auth/callback',
				'opm://auth/callback',
				'opm-dev://auth/callback',
				'trips://auth/callback',
				'trips-dev://auth/callback'
			],
			redirect
		) ||
		Option.isSome(loopback(redirect)) ||
		Option.exists(
			Result.getSuccess(Url.fromString(redirect)),
			target =>
				Option.isSome(previewOrigin(redirect)) &&
				target.pathname === '/auth/callback' &&
				target.search === '' &&
				target.hash === ''
		)
	)
}

export function clientOf(clientId: string) {
	return pipe(
		Base64Url.decodeString(clientId),
		Result.getSuccess,
		Option.flatMap(Schema.decodeUnknownOption(Schema.fromJsonString(ClientInfo))),
		Option.filter(client => Array.every(client.redirects, allowedRedirect))
	)
}

// A loopback callback as written, without its port: RFC 8252 §8.4 compares everything else exactly.
function portless(redirect: string) {
	return Option.map(
		Option.filter(
			String.match(/^(?<origin>http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost))(?::\d{1,5})?(?<rest>\/.*)?$/u)(redirect),
			() => Option.isSome(loopback(redirect))
		),
		found => `${found.groups?.['origin'] ?? ''}${found.groups?.['rest'] ?? ''}`
	)
}

// The callback a request names, or a client's only one when it names none; a loopback callback may use any port, as RFC 8252 §7.3 requires.
export function matchingRedirect(client: ClientInfo, requested: Option.Option<string>) {
	return Option.match(requested, {
		onNone: () => Option.filter(Array.head(client.redirects), () => client.redirects.length === 1),
		onSome: asked =>
			Option.as(
				Array.findFirst(client.redirects, redirect => {
					if (redirect === asked) return true
					return Option.isSome(
						Option.flatMap(portless(redirect), saved => Option.filter(portless(asked), target => target === saved))
					)
				}),
				asked
			)
	})
}

// A parameter sent empty counts as left out, as OAuth 2.1 §3.1 requires.
export function given(value?: string) {
	return Option.filter(Option.fromUndefinedOr(value), String.isNonEmpty)
}

// The rest of an authorization request, checked once its client and callback are known, so each failure can go to that callback.
export const clientRequest = Effect.fnUntraced(function* (
	asked: AuthorizeClient,
	client: {clientName: string; redirectUri: string},
	params: AuthorizeParams
) {
	if (Option.isNone(given(params.response_type))) {
		return yield* AuthError.make({message: 'Send response_type=code'})
	}
	if (params.response_type !== 'code') {
		return yield* AuthError.make({error: 'unsupported_response_type', message: 'Only response_type=code is supported'})
	}
	if (params.code_challenge === undefined || params.code_challenge_method !== 'S256') {
		return yield* AuthError.make({message: 'Send a PKCE code_challenge with code_challenge_method=S256'})
	}
	if (
		!Array.every(
			Array.filter(String.split(params.scope ?? '', ' '), String.isNonEmpty),
			scope => scope === 'deslop' || scope === 'offline_access'
		)
	) {
		return yield* AuthError.make({error: 'invalid_scope', message: 'Only the deslop scope is supported'})
	}
	const resources = yield* pipe(
		Schema.decodeUnknownEffect(Schema.NonEmptyArray(Resource))(params.resource ?? []),
		Effect.mapError(cause =>
			AuthError.make({cause, error: 'invalid_target', message: 'Name a Deslop app with the resource parameter'})
		)
	)
	return ClientRequest.make({
		challenge: params.code_challenge,
		clientId: asked.client_id,
		clientName: client.clientName,
		redirectUri: client.redirectUri,
		resources,
		...Option.match(given(asked.state), {onNone: () => ({}), onSome: state => ({state})})
	})
})

// Where an authorization answer goes: the client's callback with its state and this issuer.
export function callbackUrl(request: {redirectUri: string; state?: string}, answer: Record<string, string>) {
	const target = new URL(request.redirectUri)
	for (const entry of Record.toEntries(answer)) target.searchParams.set(entry[0], entry[1])
	Option.map(given(request.state), sent => target.searchParams.set('state', sent))
	target.searchParams.set('iss', `${AUTH_URL}/api/auth`)
	return target.href
}

// The session cookie is shared with every app on the auth app's parent domain.
export function cookieDomain(url: string) {
	return pipe(new URL(url).hostname, String.split('.'), Array.drop(1), Array.join('.'))
}

// A web sign-in returns to the page that started it only over https on the auth app's own domain or a subdomain.
export function returnable(next: string, url: string) {
	const domain = cookieDomain(url)
	return Result.match(Url.fromString(next), {
		onFailure: () => false,
		onSuccess: target =>
			target.protocol === 'https:' &&
			(target.hostname === domain || String.endsWith(`.${domain}`)(target.hostname)) &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password)
	})
}
