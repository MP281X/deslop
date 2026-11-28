import {Command, Route} from '@effect/ui'

import {Context, Effect, Layer, Option, Predicate, Schema, Stream, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {observe} from '@deslop/runtime/client/atom'
import {blockingFailure, keepValueThroughOutages, liveAtom, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {Shell} from '@deslop/runtime/client/shell'
import {AuthError, UserId} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#contracts'

import type {SignedAccount} from '#identity/contract.ts'
import {AdmitParams} from '#people/contract.ts'

export type Reader = typeof Reader.Type
export const Reader = Schema.Literals(['account', 'people', 'sessions'])

export type AuthRoute = typeof AuthRoute.Type
export const AuthRoute = Route.union({
	Home: Route.make('/', {
		search: {
			error: Schema.optional(Schema.String),
			next: Schema.optional(Schema.String),
			pane: Schema.optional(Schema.Literals(['list', 'detail'])),
			person: Schema.optional(UserId)
		}
	}),
	NotFound: Route.make('/*')
})

export const isHome = AuthRoute.isAnyOf(['Home'])

export function selectedOf(route: AuthRoute) {
	if (!isHome(route) || route.search.pane === 'list') return undefined
	return route.search.person
}

export function isDetail(route: AuthRoute) {
	return isHome(route) && (route.search.pane === 'detail' || selectedOf(route) !== undefined)
}

// What a read shows: nothing while it holds a refusal, or an outage with nothing kept.
export function readValue<A, E>(result: AsyncResult.AsyncResult<A, E>) {
	if (Option.isSome(blockingFailure(result))) return Option.none<A>()
	return AsyncResult.value(result)
}

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('Auth/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	// An unreachable server is not a refusal. Keep the last account through an outage.
	const accountAtom = Client.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				Stream.unwrap(Effect.map(Client, call => call('people.account', undefined))),
				Stream.map(Option.some),
				Stream.catchTag('AuthError', error => {
					if (error.error === 'temporarily_unavailable') return Stream.fail(error)
					return Stream.make(Option.none<SignedAccount>())
				})
			),
			reconnectOnDrop
		)
	)
	const peopleAtoms = Atom.family((_viewer: UserId) => liveAtom(Client, 'people.watch'))
	const sessionAtoms = Atom.family((_viewer: UserId) => liveAtom(Client, 'sessions.watch'))
	const admitAtoms = Atom.family((id: UserId) =>
		Client.runtime.fn((allow: boolean) => Effect.flatMap(Client, call => call('people.admit', {allow, id})))
	)
	return {accountAtom, admitAtoms, peopleAtoms, sessionAtoms}
}

class AuthReads extends Context.Service<AuthReads, ReturnType<typeof makeReads>>()('@deslop/auth/reads/AuthReads') {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

export function readAuth<A, M>(pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(AuthReads.useSync(reads => observe(pick(reads), read)))
}

function admissionError(failure: unknown) {
	if (Predicate.hasProperty(failure, 'message') && String.isString(failure.message)) return failure.message
	return 'Couldn’t answer the access request'
}

export class Admit extends Command.Service<Admit>()('Auth/Admit', {
	args: {...AdmitParams.fields},
	error: Schema.String
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* AuthReads
			const registry = yield* AtomRegistry.AtomRegistry
			return args => {
				const operationAtom = reads.admitAtoms(args.id)
				return pipe(
					Effect.gen(function* () {
						yield* Atom.mount(operationAtom)
						yield* Atom.set(operationAtom, args.allow)
						return yield* Atom.getResult(operationAtom, {suspendOnWaiting: true})
					}),
					Effect.scoped,
					Effect.provideService(AtomRegistry.AtomRegistry, registry),
					Effect.asVoid,
					Effect.mapError(admissionError)
				)
			}
		})
	)
}

export class Refresh extends Command.Service<Refresh>()('Auth/Refresh', {
	args: {reader: Reader, sessionChanged: Schema.optionalKey(Schema.Boolean), viewer: Schema.optional(UserId)}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* AuthReads
			const shell = yield* Shell
			const registry = yield* AtomRegistry.AtomRegistry
			return args =>
				Effect.sync(() => {
					// The session cookie is carried by the upgrade, so a new sign-in reopens the socket.
					if (args.sessionChanged === true) registry.update(shell.credentials, version => version + 1)
					if (args.reader === 'account') {
						registry.refresh(reads.accountAtom)
						return
					}
					if (args.viewer === undefined) return
					if (args.reader === 'people') {
						registry.refresh(reads.peopleAtoms(args.viewer))
						return
					}
					registry.refresh(reads.sessionAtoms(args.viewer))
				})
		})
	)
}

// Auth's own sign-in: the page leaves for GitHub and the app opens a browser sheet. `true` once a session was stored.
export class StartSignIn extends Command.Service<StartSignIn>()('Auth/StartSignIn', {
	args: {next: Schema.optional(Schema.String)},
	error: AuthError,
	success: Schema.Boolean
}) {}

// Whether this client stays open to start over: the page reloads, the app does not.
export class SignOut extends Command.Service<SignOut>()('Auth/SignOut', {
	args: {},
	error: AuthError,
	success: Schema.Boolean
}) {}

export class RecoverSignIn extends Command.Service<RecoverSignIn>()('Auth/RecoverSignIn', {args: {}}) {}

// Once signed in, the page goes where the app that sent it here asked.
export class ReturnTo extends Command.Service<ReturnTo>()('Auth/ReturnTo', {args: {next: Schema.String}}) {}

// Auth's own part of what a host mounts on: its reads, and the commands that run on them.
export const layerAuth = pipe(Admit.layer, Layer.merge(Refresh.layer), Layer.provideMerge(AuthReads.layer))
