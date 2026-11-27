import {Effect, Predicate, Stream} from 'effect'

import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, layerPageProtocol} from '@deslop/runtime/web/client'

import {NotesError} from '#contracts'

import {makeReads} from '#screens/reads.ts'
import {paste} from '#web/clipboard.ts'

function share(text: string) {
	if (Predicate.hasProperty(navigator, 'share')) {
		return Effect.catchIf(
			Effect.tryPromise({
				catch: cause => NotesError.make({cause, message: 'The share sheet could not open.'}),
				try: () => navigator.share({text})
			}),
			error => error.cause instanceof DOMException && error.cause.name === 'AbortError',
			() => Effect.void
		)
	}
	return Effect.tryPromise({
		catch: cause => NotesError.make({cause, message: 'The note could not be copied.'}),
		try: () => navigator.clipboard.writeText(text)
	})
}

const signOut = Effect.gen(function* () {
	const response = yield* Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'Auth could not confirm sign-out'}),
		try: () => fetch('/auth/sign-out', {method: 'POST', redirect: 'manual'})
	})
	if (response.type !== 'opaqueredirect') return yield* AuthError.make({message: 'Auth could not confirm sign-out'})
	location.reload()
})

export const platform = {
	account: accountAtom,
	activation: Stream.never,
	narrow: () => matchMedia('(width < 640px), (640px <= width < 800px) and (height < 600px)').matches,
	openLink: url =>
		Effect.sync(() => {
			open(url, '_blank', 'noreferrer')
		}),
	paste,
	readDraft: () => localStorage.getItem('stash.draft') ?? '',
	settleShares: Effect.succeed([]),
	share,
	signIn: Effect.sync(() => {
		location.assign(signInUrl(location.href))
		return false
	}),
	signOut,
	writeDraft: text => localStorage.setItem('stash.draft', text)
}

export const reads = makeReads(layerPageProtocol)
