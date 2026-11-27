import {Effect, Option, Queue, Stream} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {FetchHttpClient} from 'effect/http'
import {Atom} from 'effect/reactivity'
import AppState from 'react-native/Libraries/AppState/AppState'
import Linking from 'react-native/Libraries/Linking/Linking'
import Share from 'react-native/Libraries/Share/Share'
import Dimensions from 'react-native/Libraries/Utilities/Dimensions'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'

import {NoteId} from '#contracts'

import {StashNative, atDevice} from '#iphone/device.ts'
import {readIPhoneAccount, session, signOut} from '#iphone/session.ts'
import type {Platform} from '#screens/notes.ts'
import {copiedLink, makeReads} from '#screens/reads.ts'

const activation = Stream.callback<void>(queue =>
	Effect.acquireRelease(
		Effect.sync(() => {
			Queue.offerUnsafe(queue, undefined)
			return AppState.addEventListener('change', state => {
				if (state === 'active') Queue.offerUnsafe(queue, undefined)
			})
		}),
		listener => Effect.sync(() => listener.remove())
	)
)

const paste = Effect.gen(function* () {
	const clipboard = yield* atDevice('The clipboard could not be read.', StashNative.paste)
	const image = clipboard.image
	if (image === undefined) return Option.some(yield* copiedLink(clipboard.text ?? ''))
	const id = NoteId.make(SecureRandom.uuidV4Unsafe())
	yield* atDevice('The copied image could not be saved.', () => StashNative.saveImage(id, image))
	return Option.none<string>()
})

export const platform = {
	account: Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount),
	activation,
	narrow: () => {
		const windowSize = Dimensions.get('window')
		return windowSize.width < 640 || (windowSize.width < 800 && windowSize.height < 600)
	},
	openLink: Effect.fnUntraced(function* (url: string) {
		yield* atDevice('The link could not be opened.', () => Linking.openURL(url))
	}),
	paste,
	readDraft: StashNative.readDraft,
	settleShares: atDevice('Queued shares could not be sent.', StashNative.settleShares),
	share: Effect.fnUntraced(function* (text: string) {
		yield* atDevice('The share sheet could not open.', () => Share.share({message: text}))
	}),
	signIn: session.signIn,
	signOut,
	writeDraft: StashNative.writeDraft
} satisfies Platform

export const reads = makeReads(layerSocketProtocol(session.layerIPhoneSocket))
