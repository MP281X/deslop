import {Option, Schema, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {ToolbarAction} from '@deslop/components/model'
import {AuthError} from '@deslop/runtime/shared/auth'

import {readValue} from '#reads'

import {SignedAccount} from '#identity/contract.ts'

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Schema.Option(SignedAccount)})
export type AccountRead = typeof AccountRead.Type

// The signed-in account and the sign-in and sign-out that change it, with the messages that fill them.
export const identityFields = {
	account: AccountRead,
	signInError: Schema.optional(Schema.String),
	signOutError: Schema.optional(Schema.String)
}
export const identityMessages = {
	Account: {result: AccountRead},
	SignIn: {},
	SignInFailed: {error: AuthError},
	SignInFinished: {signedIn: Schema.Boolean},
	SignOut: {},
	SignOutFailed: {error: AuthError},
	SignOutFinished: {stays: Schema.Boolean}
}

export function signed(result: AccountRead) {
	return pipe(readValue(result), Option.flatten, Option.getOrUndefined)
}

export function showSignOut(pending: boolean, viewer?: SignedAccount) {
	if (viewer?.signOut !== true) return []
	return [
		{disabled: pending, id: 'sign-out', label: 'Sign out', symbol: 'rectangle.portrait.and.arrow.right'}
	] satisfies readonly ToolbarAction[]
}

export function accessState(account: AccountRead, viewer?: SignedAccount) {
	if (viewer?.role === 'Waiting') return 'waiting'
	if (Option.exists(readValue(account), Option.isNone)) return 'sign-in'
	return 'refused'
}
