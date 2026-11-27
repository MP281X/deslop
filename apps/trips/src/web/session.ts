import {Effect, Predicate, Queue, Stream} from 'effect'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, layerPageProtocol} from '@deslop/runtime/web/client'

import {tripsData} from '#screens/data.ts'
import {Message} from '#screens/model.ts'
import {makeTrips} from '#screens/trips.ts'
import {readTicket} from '#web/ticket.ts'

const clipboard = Stream.callback<Message>(queue => {
	function paste(event: ClipboardEvent) {
		const file = event.clipboardData?.files.item(0)
		if (Predicate.isNullish(file)) return
		event.preventDefault()
		Queue.offerUnsafe(queue, Message.PasteFile({file}))
	}
	return Effect.acquireRelease(
		Effect.sync(() => document.addEventListener('paste', paste)),
		() => Effect.sync(() => document.removeEventListener('paste', paste))
	)
})

const boardReads = tripsData({
	account: accountAtom,
	protocol: layerPageProtocol,
	refreshAccount: registry => registry.refresh(accountAtom)
})

export const tripsScreen = makeTrips(boardReads, {
	clipboard,
	openUrl: url => Effect.sync(() => location.assign(url)),
	signIn: Effect.sync(() => {
		location.assign(signInUrl(location.href))
		return false
	}),
	signOut: () =>
		Effect.sync(() => {
			const form = document.createElement('form')
			form.action = `/auth/sign-out?${new URLSearchParams({next: location.href})}`
			form.method = 'post'
			form.hidden = true
			document.body.append(form)
			form.requestSubmit()
			return undefined
		}),
	ticket: readTicket
})
