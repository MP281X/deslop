import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError, RpcAdmin, RpcAuth} from '@deslop/runtime/shared/auth'

import {ListedSession} from '#services/cookie-sessions/schema.ts'
import {AdmitParams, Person, SignedAccount} from '#services/people/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('people.watch', {error: AuthError, stream: true, success: Schema.Array(Person)}).middleware(RpcAdmin),
	Rpc.make('people.admit', {error: AuthError, payload: AdmitParams, success: Person}).middleware(RpcAdmin),
	Rpc.make('sessions.watch', {error: AuthError, stream: true, success: Schema.Array(ListedSession)})
)
	.middleware(RpcAuth)
	.merge(RpcGroup.make(Rpc.make('people.account', {error: AuthError, stream: true, success: SignedAccount}))) {}
