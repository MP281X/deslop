import {Array, DateTime, Effect, Option, Order, Record, Result, Schema, String, pipe} from 'effect'

import {Digest} from 'effect/crypto'
import type {SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Cookies, Headers, Url} from 'effect/http'
import {NetAddress} from 'effect/net'

import {AuthError, ClientRegistration, SESSION_COOKIE} from '@deslop/runtime/shared/auth'
import type {ClientId, UserId} from '@deslop/runtime/shared/auth'
import {isPrivateAddress} from '@deslop/runtime/shared/net'

import type {
	AuthorizeClient,
	AuthorizeParams,
	CredentialOwner,
	IncarnationId,
	Origin,
	SignedInApp
} from '#services/tokens/schema.ts'
import {ClientRequest} from '#services/tokens/schema.ts'

// The workers by their public and tailnet addresses; Traefik runs on dev, so dev's own requests may also arrive from a private one.
const WORKERS: Record<string, string> = {
	'77.237.236.132': 'dev',
	'100.68.201.107': 'dev',
	'100.97.120.3': 'desktop',
	'100.115.207.60': 'macbook-pro'
}

export function browserToken(headers: Headers.Headers) {
	return Option.fromUndefinedOr(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE])
}

export function sameOwner(left: CredentialOwner, right: CredentialOwner) {
	return left.user.id === right.user.id && left.incarnation === right.incarnation
}

// The account a stored credential belongs to, from the owner columns it keeps.
export function credentialOwnerOf(row: {incarnation: IncarnationId; userId: UserId; userName: string}) {
	return {incarnation: row.incarnation, user: {id: row.userId, name: row.userName}}
}

// A secret as its URL-safe base64, and a value as the same digest every comparison uses, bound once in each layer.
export function randomTokenOf(random: SecureRandom.SecureRandom['Service']) {
	return (bytes: number) => Effect.map(random.randomBytes(bytes), Base64Url.encode)
}

export function hashOf(digest: Digest.Digest['Service']) {
	return (value: string) => Effect.map(digest.digest(Digest.sha256, new TextEncoder().encode(value)), Base64Url.encode)
}

// Child app sign-ins are never rows of their own; their browser takes the newest activity and address.
function withChildActivity(signIns: readonly SignedInApp[]) {
	const children = pipe(
		signIns,
		Array.map(signIn => Option.map(signIn.parent, parent => ({parent, signIn}))),
		Array.getSomes,
		Array.groupBy(entry => entry.parent)
	)
	return pipe(
		signIns,
		Array.filter(signIn => Option.isNone(signIn.parent)),
		Array.map(signIn => {
			const latest = Array.reduce(
				pipe(
					children,
					Record.get(signIn.family),
					Option.getOrElse(() => []),
					Array.map(entry => entry.signIn)
				),
				signIn,
				Order.max(Order.mapInput(DateTime.Order, (app: SignedInApp) => app.lastActive))
			)
			return {
				address: latest.address,
				client: signIn.client,
				device: signIn.device,
				family: signIn.family,
				icon: signIn.icon,
				kind: signIn.kind,
				lastActive: latest.lastActive,
				parent: signIn.parent
			}
		})
	)
}

// The address as its own family, an IPv4-mapped IPv6 address read as that IPv4 address.
function parsedAddress(address: string) {
	return Option.map(Result.getSuccess(NetAddress.ipFromString(address)), ip => {
		if (NetAddress.isIpv6Address(ip)) return Option.getOrElse(NetAddress.fromIpv4Mapped(ip), () => ip)
		return ip
	})
}

// Whoever holds an IPv6 address holds its whole /64, so limits count the /64.
export function addressGroup(address: string) {
	return Option.match(parsedAddress(address), {
		onNone: () => address,
		onSome: ip => {
			if (NetAddress.isIpv4Address(ip)) return NetAddress.formatIp(ip)
			return pipe(
				NetAddress.ipv6ToSegments(ip),
				Array.take(4),
				Array.map(segment => segment.toString(16)),
				Array.join(':')
			)
		}
	})
}

// The address the client connects from: Traefik appends it as the last X-Forwarded-For entry, earlier ones are the client's word.
export function clientAddress(headers: Headers.Headers, remote: Option.Option<string>) {
	return pipe(
		Headers.get(headers, 'x-forwarded-for'),
		Option.flatMap(forwarded => Array.last(String.split(forwarded, ','))),
		Option.map(String.trim),
		Option.filter(String.isNonEmpty),
		Option.orElse(() => remote)
	)
}

export function originFrom(headers: Headers.Headers, remote: Option.Option<string>) {
	return {
		address: clientAddress(headers, remote),
		userAgent: pipe(headers, Headers.get('user-agent'), Option.map(String.slice(0, 200)))
	}
}

// "Claude Code (auth)" reads Claude Code, "codex" Codex: the app, as the signed-in list names it.
export function clientLabel(name: string) {
	return pipe(
		name,
		String.replace(/\s*\([^)]*\)$/u, ''),
		String.trim,
		String.capitalize,
		Option.liftPredicate(String.isNonEmpty),
		Option.getOrElse(() => 'Unknown client')
	)
}

function platform(userAgent: string) {
	if (String.includes('iPhone')(userAgent)) return Option.some('iPhone')
	if (String.includes('iPad')(userAgent)) return Option.some('iPad')
	// The iOS apps call in through CFNetwork, whose User-Agent names neither device.
	if (String.includes('CFNetwork/')(userAgent)) return Option.some('iPhone')
	if (String.includes('Android')(userAgent)) return Option.some('Android')
	if (String.includes('Macintosh')(userAgent)) return Option.some('Mac')
	if (String.includes('Windows')(userAgent)) return Option.some('Windows')
	if (String.includes('Linux')(userAgent)) return Option.some('Linux')
	return Option.none()
}

export function browserLabel(origin: Origin) {
	return Option.match(origin.userAgent, {
		onNone: () => 'Browser',
		onSome: agent => {
			if (String.includes('Edg/')(agent)) return 'Edge'
			if (String.includes('Firefox/')(agent)) return 'Firefox'
			if (String.includes('Chrome/')(agent)) return 'Chrome'
			if (String.includes('Safari/')(agent)) return 'Safari'
			return 'Browser'
		}
	})
}

export function deviceLabel(origin: Origin) {
	return pipe(
		Option.flatMap(origin.address, address => {
			if (
				Option.exists(
					parsedAddress(address),
					ip => NetAddress.isLinkLocal(ip) || NetAddress.isLoopback(ip) || isPrivateAddress(ip)
				)
			) {
				return Option.some('dev')
			}
			return Record.get(WORKERS, address)
		}),
		Option.orElse(() => Option.flatMap(origin.userAgent, platform)),
		Option.getOrElse(() => Option.getOrElse(origin.address, () => 'unknown'))
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

export function webRedirect(redirect: string) {
	return Option.isSome(
		String.match(/^https:\/\/[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.mp281x\.xyz\/auth\/callback$/u)(redirect)
	)
}

// Deslop web and iOS apps, a desktop agent's loopback, or Gateway's per-server callback.
export function allowedRedirect(redirect: string) {
	return (
		webRedirect(redirect) ||
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
		Option.isSome(loopback(redirect))
	)
}

export function clientOf(clientId: ClientId) {
	return pipe(
		Base64Url.decodeString(clientId),
		Result.getSuccess,
		Option.flatMap(Schema.decodeUnknownOption(Schema.fromJsonString(ClientRegistration))),
		Option.filter(client => Array.every(client.redirects, allowedRedirect))
	)
}

// An icon belongs to a registered callback, never to an app name supplied by a client.
export function clientIconOf(clientId: ClientId) {
	return pipe(
		clientOf(clientId),
		Option.flatMap(client =>
			Array.findFirst(
				client.redirects,
				redirect => webRedirect(redirect) || Option.isSome(String.match(/^(?:stash|opm|trips)(?:-dev)?:/u)(redirect))
			)
		),
		Option.map(redirect => {
			const url = new URL(redirect)
			if (url.protocol === 'https:') return url.origin
			return `https://${pipe(url.protocol, String.slice(0, -1), String.replace(/-dev$/u, ''))}.mp281x.xyz`
		})
	)
}

// Both transports show the same rows, with a browser's child activity merged before grouping.
export function signedInClientsOf(signIns: readonly SignedInApp[]) {
	return pipe(
		Array.groupBy(withChildActivity(signIns), signIn => `${signIn.client} · ${signIn.device}`),
		Record.values,
		Array.filter(Array.isReadonlyArrayNonEmpty),
		Array.map(group =>
			Array.reduce(group, group[0], Order.max(Order.mapInput(DateTime.Order, (row: SignedInApp) => row.lastActive)))
		),
		Array.sort(Order.flip(Order.mapInput(DateTime.Order, (row: SignedInApp) => row.lastActive)))
	)
}

// A loopback callback as written, without its port: RFC 8252 §8.4 compares everything else exactly.
function portless(redirect: string) {
	return pipe(
		String.match(/^(?<origin>http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost))(?::\d{1,5})?(?<rest>\/.*)?$/u)(redirect),
		Option.filter(() => Option.isSome(loopback(redirect))),
		Option.map(found => `${found.groups?.['origin'] ?? ''}${found.groups?.['rest'] ?? ''}`)
	)
}

// The callback a request names, or a client's only one when it names none; a loopback callback may use any port, as RFC 8252 §7.3 requires.
export function matchingRedirect(client: ClientRegistration, requested: Option.Option<string>) {
	return Option.match(requested, {
		onNone: () => Option.filter(Array.head(client.redirects), () => client.redirects.length === 1),
		onSome: asked =>
			pipe(
				client.redirects,
				Array.findFirst(redirect => {
					if (redirect === asked) return true
					return Option.isSome(
						Option.flatMap(portless(redirect), saved => Option.filter(portless(asked), target => target === saved))
					)
				}),
				Option.as(asked)
			)
	})
}

// A parameter sent empty counts as left out, as OAuth 2.1 §3.1 requires.
export function given(value: Option.Option<string>) {
	return Option.filter(value, String.isNonEmpty)
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
	if (!Option.contains(params.response_type, 'code')) {
		return yield* AuthError.make({error: 'unsupported_response_type', message: 'Only response_type=code is supported'})
	}
	if (Option.isNone(params.code_challenge) || !Option.contains(params.code_challenge_method, 'S256')) {
		return yield* AuthError.make({message: 'Send a PKCE code_challenge with code_challenge_method=S256'})
	}
	if (
		!pipe(
			params.scope,
			Option.match({onNone: Array.empty<string>, onSome: String.split(' ')}),
			Array.filter(String.isNonEmpty),
			Array.every(scope => scope === 'deslop' || scope === 'offline_access')
		)
	) {
		return yield* AuthError.make({error: 'invalid_scope', message: 'Only the deslop scope is supported'})
	}
	return ClientRequest.make({
		challenge: yield* Effect.fromOption(params.code_challenge),
		clientId: asked.client_id,
		clientName: client.clientName,
		parent: Option.none(),
		redirectUri: client.redirectUri,
		state: given(asked.state)
	})
})

export function callbackUrl(
	request: {redirectUri: string; state: Option.Option<string>},
	answer: Record<string, string>,
	issuer: string
) {
	const target = new URL(request.redirectUri)
	for (const entry of Record.toEntries(answer)) target.searchParams.set(entry[0], entry[1])
	Option.map(given(request.state), sent => target.searchParams.set('state', sent))
	target.searchParams.set('iss', issuer)
	return target.href
}

export function returnable(next: string, url: string) {
	const domain = 'mp281x.xyz'
	return Result.match(Url.fromString(next), {
		onFailure: () => false,
		onSuccess: target =>
			(target.origin === new URL(url).origin ||
				(target.protocol === 'https:' &&
					(target.hostname === domain || String.endsWith(`.${domain}`)(target.hostname)))) &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password)
	})
}
