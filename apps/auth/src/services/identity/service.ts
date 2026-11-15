import {networkInterfaces} from 'node:os'

import {Array, Cache, Context, Effect, Function, Layer, Option, Record, Result, Schema, String, pipe} from 'effect'

import type {Headers} from 'effect/http'
import {IpNetwork, NetAddress} from 'effect/net'
import {ChildProcessSpawner} from 'effect/process'

import {Auth, adminIds, identifyRequestOf, localAuth} from '@deslop/runtime/server/auth'
import {executeProcess} from '@deslop/runtime/server/process'
import {AuthError, DEVELOPER, UserId, asAuthError} from '@deslop/runtime/shared/auth'
import type {IdentifyRequest, User} from '@deslop/runtime/shared/auth'
import type {Account} from '@deslop/runtime/shared/schema'

import type {Profile} from './schema.ts'
import {Status, Whois} from './schema.ts'

import {CookieSessions} from '#services/cookie-sessions/service.ts'
import {GitHub} from '#services/github/service.ts'
import {roleOf} from '#services/people/lib/utils.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import {People} from '#services/people/service.ts'

export function isMachine(address: string) {
	return Array.some(
		Record.values(networkInterfaces()),
		entries => entries !== undefined && Array.some(entries, entry => entry.address === address)
	)
}
// Tailscale's address ranges.
const TAILNET = [IpNetwork.fromStringUnsafe('100.64.0.0/10'), IpNetwork.fromStringUnsafe('fd7a:115c:a1e0::/48')]

function isTailnet(address: string) {
	return Option.exists(Result.getSuccess(NetAddress.ipFromString(address)), ip =>
		Array.some(TAILNET, network => IpNetwork.contains(network, ip))
	)
}
export class Identity extends Context.Service<
	Identity,
	{
		readonly resolve: (request: IdentifyRequest, waiting?: boolean) => Effect.Effect<SignedAccount, AuthError>
		readonly account: (headers: Headers.Headers) => Effect.Effect<Account, AuthError>
	}
>()('@deslop/auth/services/identity/service/Identity') {
	static readonly layer = Layer.effect(
		Identity,
		Effect.gen(function* () {
			const people = yield* People
			const sessions = yield* CookieSessions
			const github = yield* GitHub
			const local = yield* localAuth
			const admins = yield* adminIds
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const status = yield* Cache.makeWith(
				() =>
					pipe(
						executeProcess('tailscale', ['status', '--json']),
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Status))),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						Effect.timeout('10 seconds'),
						asAuthError('Cannot read the tailnet owner')
					),
				{capacity: 1, timeToLive: Function.constant('1 minute')}
			)
			const whois = yield* Cache.makeWith(
				(address: string) =>
					pipe(
						executeProcess('tailscale', ['whois', '--json', address]),
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Whois))),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						Effect.timeout('10 seconds'),
						asAuthError('Cannot identify the tailnet caller')
					),
				{capacity: 1024, timeToLive: Function.constant('1 minute')}
			)
			const tailnet = Effect.fnUntraced(function* (profile: Profile) {
				if (String.endsWith('@github')(profile.LoginName)) {
					const name = String.slice(0, -7)(profile.LoginName)
					return yield* Option.match(yield* people.login(name), {
						onNone: () =>
							Effect.gen(function* () {
								const user = yield* github.login(name)
								return yield* people.register({id: UserId.make(`github:${user.id}`), name: user.login}, user.name, true)
							}),
						onSome: member => people.register({id: member.id, name: member.name}, member.fullName, true)
					})
				}
				return yield* people.register(
					{id: UserId.make(`tailnet:${profile.LoginName}`), name: profile.DisplayName || profile.LoginName},
					Option.none(),
					true
				)
			})

			const resolve = Effect.fn('Identity.resolve')(function* (request: IdentifyRequest, waiting: boolean = false) {
				if (local) return {...DEVELOPER, fullName: Option.none(), role: 'Admin' as const, signOut: false}
				const identified = yield* Option.match(
					yield* Option.match(request.session, {onNone: () => Effect.succeedNone, onSome: sessions.current}),
					{
						onNone: () =>
							pipe(
								request.address,
								Option.match({
									onNone: () => Effect.fail(AuthError.make({message: 'Sign in first'})),
									onSome: address =>
										Effect.gen(function* () {
											if (isMachine(address)) {
												return yield* Option.match(request.onBehalfOf, {
													onNone: () =>
														Effect.gen(function* () {
															const found = yield* Cache.get(status, 'self')
															if ((found.Self.Tags?.length ?? 0) > 0) {
																return yield* AuthError.make({message: 'Sign in first'})
															}
															// Tailscale ids exceed JS's safe integer range; compare the equally decoded ids, not a rounded id against an exact record key.
															return yield* pipe(
																Record.values(found.User),
																Array.findFirst(profile => profile.ID === found.Self.UserID),
																Option.match({
																	onNone: () => Effect.fail(AuthError.make({message: 'Sign in first'})),
																	onSome: tailnet
																})
															)
														}),
													onSome: people.allowed
												})
											}
											if (!isTailnet(address)) return yield* AuthError.make({message: 'Sign in first'})
											const found = yield* Cache.get(whois, address)
											if ((found.Node.Tags?.length ?? 0) > 0) return yield* AuthError.make({message: 'Sign in first'})
											return yield* tailnet(found.UserProfile)
										})
								}),
								Effect.map((user: User) => ({id: user.id, signOut: false}))
							),
						onSome: row => Effect.succeed({id: row.userId, signOut: true})
					}
				)
				const row = yield* people.find(identified.id)
				return {
					...(yield* Option.match(row, {
						onNone: () => people.allowed(identified.id),
						onSome: member => {
							if (waiting && identified.signOut) return Effect.succeed({id: member.id, name: member.name})
							return people.allowed(identified.id)
						}
					})),
					fullName: Option.flatMap(row, member => member.fullName),
					role: roleOf(admins, identified.id, row),
					signOut: identified.signOut
				}
			}, asAuthError('Cannot identify the caller'))
			return Identity.of({
				account: Effect.fn('Identity.account')(function* (headers) {
					return yield* resolve(identifyRequestOf(headers))
				}),
				resolve
			})
		})
	)
}
export const layerIdentityAuth = Layer.effectContext(
	Effect.map(Identity, identity => Auth.makeContext(identity.account))
)
