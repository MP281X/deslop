import {Boolean, Effect, Function, Layer, Option, Schema, pipe} from 'effect'

import {Capacitor} from '@capacitor/core'
import type {AtomRegistry} from 'effect/reactivity'
import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import {isDenied, signInUrl} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {Account} from '@deslop/runtime/shared/schema'
import {layerOtlp} from '@deslop/runtime/shared/telemetry'
import {accountAtom as pageAccount, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'
import {layerNativeProtocol, nativeAccount, nativeServer, nativeSignIn, nativeSignOut} from '@deslop/ui/native'

import {TripsRpcs} from '#contracts'

const ACCOUNT_KEY = 'trips.account'
export const FLIGHTS_KEY = 'trips.flights'

export const native = Capacitor.isNativePlatform()

if (native) {
	Atom.runtime.addGlobalLayer(
		Layer.unwrap(
			Effect.match(nativeServer, {
				onFailure: Function.constant(Layer.empty),
				onSuccess: server => {
					if (new URL(server).hostname !== 'trips.mp281x.xyz') return Layer.empty
					return layerOtlp('@deslop/trips-ios', 'https://scope.mp281x.xyz', 'mobile', '0.1.0')
				}
			})
		)
	)
} else {
	addPageTelemetry('@deslop/trips')
}

type LocalAccount = typeof LocalAccount.Type
// iOS keeps the last admitted account for its offline board.
const LocalAccount = Schema.fromJsonString(Account)
const cachedAccountAtom = Atom.keepAlive(
	Atom.make(
		Boolean.match(native, {
			onFalse: () => Option.none<Account>(),
			onTrue: () =>
				Option.flatMap(Option.fromNullishOr(localStorage.getItem(ACCOUNT_KEY)), Schema.decodeOption(LocalAccount))
		})
	)
)

function clearAccount() {
	localStorage.removeItem(ACCOUNT_KEY)
	localStorage.removeItem(FLIGHTS_KEY)
}

const checkedAccountAtom = Atom.make(get =>
	pipe(
		nativeAccount,
		Effect.tap(account =>
			Effect.gen(function* () {
				const copy = yield* Effect.option(Schema.encodeEffect(LocalAccount)(account))
				if (
					!pipe(
						get.registry.get(cachedAccountAtom),
						Option.map(saved => saved.id),
						Option.contains(account.id)
					)
				) {
					localStorage.removeItem(FLIGHTS_KEY)
				}
				Option.map(copy, text => localStorage.setItem(ACCOUNT_KEY, text))
				get.registry.set(cachedAccountAtom, Option.some(account))
			})
		),
		Effect.tapError(error =>
			Effect.sync(() => {
				if (!isDenied(error)) return
				clearAccount()
				get.registry.set(cachedAccountAtom, Option.none())
			})
		)
	)
)

const mobileAccountAtom = Atom.make(get => {
	const checked = get(checkedAccountAtom)
	if (AsyncResult.isFailure(checked) && Option.exists(AsyncResult.error(checked), isDenied)) return checked
	return Option.match(get(cachedAccountAtom), {
		onNone: () => {
			if (AsyncResult.isSuccess(checked)) return AsyncResult.initial()
			return checked
		},
		onSome: account => AsyncResult.success(account)
	})
})

export const accountAtom = Boolean.match(native, {
	onFalse: Function.constant(pageAccount),
	onTrue: Function.constant(mobileAccountAtom)
})
export const refreshAccount = Boolean.match(native, {
	onFalse: Function.constant(pageAccount),
	onTrue: Function.constant(checkedAccountAtom)
})

export const signIn = Boolean.match(native, {
	onFalse: () =>
		Effect.sync(() => {
			location.replace(signInUrl(location.href))
			return false
		}),
	onTrue: Function.constant(nativeSignIn)
})

export const signOut = Effect.tap(nativeSignOut, Effect.sync(clearAccount))

export function resetAccount(registry: AtomRegistry.AtomRegistry) {
	registry.set(cachedAccountAtom, Option.none())
	registry.refresh(checkedAccountAtom)
}

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/trips/web/flights/session/RpcClient', {
	group: TripsRpcs.middleware(RpcStream),
	protocol: Boolean.match(native, {
		onFalse: Function.constant(layerPageProtocol),
		onTrue: Function.constant(layerNativeProtocol)
	})
}) {}
