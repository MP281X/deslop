import {Effect, Queue, Stream, pipe} from 'effect'

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
import {layerIPhoneSocket, readIPhoneAccount, signIn, signOut} from '#iphone/session.ts'
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
	if (image === undefined) return yield* copiedLink(clipboard.text ?? '')
	const id = NoteId.make(SecureRandom.uuidV4Unsafe())
	yield* atDevice('The copied image could not be saved.', () => StashNative.saveImage(id, image))
	return undefined
})

export const platform = {
	account: Atom.runtime(FetchHttpClient.layer).atom(readIPhoneAccount),
	activation,
	narrow: () => {
		const {height, width} = Dimensions.get('window')
		return width < 640 || (width < 800 && height < 600)
	},
	openLink: (url: string) => Effect.asVoid(atDevice('The link could not be opened.', () => Linking.openURL(url))),
	paste,
	readDraft: StashNative.readDraft,
	settleShares: atDevice('Queued shares could not be sent.', StashNative.settleShares),
	share: (text: string) =>
		pipe(
			atDevice('The share sheet could not open.', () => Share.share({message: text})),
			Effect.asVoid
		),
	signIn,
	signOut,
	writeDraft: StashNative.writeDraft
}

export const reads = makeReads(layerSocketProtocol(layerIPhoneSocket))
