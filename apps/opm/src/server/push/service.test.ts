import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Deferred, Effect, Fiber, FileSystem, Layer, MutableRef, Option, Redacted, String, pipe} from 'effect'

import {Apns} from '@deslop/runtime/server/apns'
import {layerDataStore} from '@deslop/runtime/server/store'
import {ApnsAnswer, ApnsToken} from '@deslop/runtime/shared/apns'

import {ChapterNumber} from '#contracts'

import {Chapter} from '#server/chapters/schema.ts'
import {Chapters} from '#server/chapters/service.ts'
import {Push} from '#server/push/service.ts'

const ANSWER = {channel: Option.none(), reason: Option.none(), status: 200}

function chapter(number: number) {
	return Chapter.make({
		notified: false,
		number: ChapterNumber.make(number),
		pages: ['https://example.com/page.png'],
		postedAt: Option.none(),
		revisedAt: Option.none(),
		series: 'manga',
		source: 'https://cubari.moe/read/imgchest/fixture/',
		title: ''
	})
}

function device(name: string, bundle = 'xyz.mp281x.opm') {
	return {bundle, kind: 'start' as const, token: Redacted.make(ApnsToken.make(String.repeat(64)(name)))}
}

// Apple answers each device by the first character of its token, as a test sets, after the test lets it; each send is recorded.
function apple() {
	const answers = MutableRef.make<Record<string, ApnsAnswer>>({})
	const sent = MutableRef.make<string[]>([])
	const held = MutableRef.make<Record<string, {asked: Deferred.Deferred<void>; answer: Deferred.Deferred<void>}>>({})
	const layer = pipe(
		Push.layer,
		Layer.provide(
			Layer.mock(Apns, {
				enabled: true,
				sendToDevice: target =>
					Effect.gen(function* () {
						const name = String.slice(0, 1)(Redacted.value(target.token))
						MutableRef.update(sent, names => [...names, name])
						const hold = MutableRef.get(held)[name]
						if (hold !== undefined) {
							yield* Deferred.succeed(hold.asked, undefined)
							yield* Deferred.await(hold.answer)
						}
						return MutableRef.get(answers)[name] ?? ApnsAnswer.cases.Accepted.make(ANSWER)
					})
			})
		),
		Layer.provideMerge(Chapters.migrations),
		Layer.provideMerge(
			Layer.unwrap(
				pipe(
					FileSystem.FileSystem,
					Effect.flatMap(fs => fs.makeTempDirectoryScoped()),
					Effect.map(layerDataStore)
				)
			)
		),
		Layer.provide(NodeServices.layer)
	)
	return {answers, held, layer, sent}
}

const recipients = apple()
it.layer(recipients.layer)(test => {
	test.effect(
		'announces a chapter only to the devices registered when it was saved',
		Effect.fnUntraced(function* () {
			const push = yield* Push
			yield* push.takeRecipients(chapter(243))
			yield* push.register(device('a'))
			yield* push.register(device('b'))
			yield* push.takeRecipients(chapter(244))
			yield* push.register(device('c'))
			MutableRef.set(recipients.answers, {b: ApnsAnswer.cases.Retry.make({...ANSWER, status: 503})})
			assert.isFalse(yield* push.announce(chapter(244)))
			assert.deepStrictEqual(MutableRef.getAndSet(recipients.sent, []), ['a', 'b'])
			MutableRef.set(recipients.answers, {})
			assert.isTrue(yield* push.announce(chapter(244)))
			assert.deepStrictEqual(MutableRef.getAndSet(recipients.sent, []), ['b'])
			assert.isTrue(yield* push.announce(chapter(243)))
			assert.deepStrictEqual(MutableRef.getAndSet(recipients.sent, []), [])
			yield* push.takeRecipients(chapter(245))
			assert.isTrue(yield* push.announce(chapter(245)))
			assert.deepStrictEqual(MutableRef.get(recipients.sent), ['a', 'b', 'c'])
		})
	)
})

const kept = apple()
it.layer(kept.layer)(test => {
	test.effect(
		'keeps a device whose alert was too large, and one registered again while Apple called its token dead',
		Effect.fnUntraced(function* () {
			const push = yield* Push
			const hold = {answer: yield* Deferred.make<void>(), asked: yield* Deferred.make<void>()}
			MutableRef.set(kept.answers, {
				a: ApnsAnswer.cases.TooLarge.make({...ANSWER, status: 413}),
				d: ApnsAnswer.cases.DeadToken.make({...ANSWER, status: 410})
			})
			MutableRef.set(kept.held, {d: hold})
			yield* push.register(device('a'))
			yield* push.register(device('d'))
			yield* push.takeRecipients(chapter(244))
			const announcing = yield* Effect.forkChild(push.announce(chapter(244)))
			yield* Deferred.await(hold.asked)
			// The phone registers the same token for its development build while Apple's answer is on its way.
			yield* push.register(device('d', 'xyz.mp281x.opm.dev'))
			yield* Deferred.succeed(hold.answer, undefined)
			assert.isTrue(yield* Fiber.join(announcing))
			MutableRef.set(kept.answers, {})
			MutableRef.set(kept.held, {})
			yield* push.takeRecipients(chapter(245))
			assert.isTrue(yield* push.announce(chapter(245)))
			assert.deepStrictEqual(MutableRef.get(kept.sent), ['a', 'd', 'a', 'd'])
		})
	)
})
