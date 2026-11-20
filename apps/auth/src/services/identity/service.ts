import {networkInterfaces} from 'node:os'

import {Array, Context, Effect, Layer, Option, Record, Result, String, pipe} from 'effect'

import type {Headers} from 'effect/http'
import {IpNetwork, NetAddress} from 'effect/net'

import {Auth, identifyRequestOf, localAuth} from '@deslop/runtime/server/auth'
import {AuthError, DEVELOPER, UserId, asAuthError} from '@deslop/runtime/shared/auth'
import type {IdentifyRequest} from '@deslop/runtime/shared/auth'
import type {Account} from '@deslop/runtime/shared/schema'

import {GitHub} from '#services/github/service.ts'
import {authorizeMember, roleOf} from '#services/people/lib/utils.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import {People, adminIds} from '#services/people/service.ts'
import {Sessions} from '#services/sessions/service.ts'
import type {Profile} from '#services/tailnet/schema.ts'
import {Tailnet} from '#services/tailnet/service.ts'

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
			const sessions = yield* Sessions
			const github = yield* GitHub
			const local = yield* localAuth
			const admins = yield* adminIds
			const owners = yield* Tailnet
			const tailnet = Effect.fnUntraced(function* (profile: Profile) {
				if (String.endsWith('@github')(profile.LoginName)) {
					const user = yield* github.login(String.slice(0, -7)(profile.LoginName))
					return yield* people.register({id: UserId.make(`github:${user.id}`), name: user.login}, user.name, true)
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
															const found = yield* owners.status
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
													onSome: id => Effect.succeed({id})
												})
											}
											if (!isTailnet(address)) return yield* AuthError.make({message: 'Sign in first'})
											const found = yield* owners.whois(address)
											if ((found.Node.Tags?.length ?? 0) > 0) return yield* AuthError.make({message: 'Sign in first'})
											return yield* tailnet(found.UserProfile)
										})
								}),
								Effect.map((user: {readonly id: UserId}) => ({id: user.id, signOut: false}))
							),
						onSome: row => Effect.succeed({id: row.userId, signOut: true})
					}
				)
				const row = yield* people.find(identified.id)
				const role = roleOf(admins, identified.id, row)
				return {
					...(yield* Option.match(row, {
						onNone: () => authorizeMember(admins, identified.id, row),
						onSome: member => {
							if (waiting && identified.signOut) return Effect.succeed({id: member.id, name: member.name})
							return authorizeMember(admins, identified.id, row)
						}
					})),
					admin: role === 'Admin',
					fullName: Option.flatMap(row, member => member.fullName),
					role,
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
