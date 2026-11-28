import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {AuthError} from '@deslop/runtime/shared/auth'

import {Account} from '#people/contract.ts'

export type SignedAccount = typeof SignedAccount.Type
export const SignedAccount = Schema.Struct({...Account.fields, signOut: Schema.Boolean})

// Whoever asks for their own account is not yet a person the people's guard admits, so this one answers on its own.
export const IdentityRpcs = RpcGroup.make(
	Rpc.make('people.account', {error: AuthError, stream: true, success: SignedAccount})
)
