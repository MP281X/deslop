import {
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	FiberMap,
	Layer,
	MutableHashMap,
	Option,
	Stream,
	SubscriptionRef,
	pipe
} from 'effect'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer} from '@deslop/runtime/shared/apns'
import type {UserId} from '@deslop/runtime/shared/auth'

import type {ActivityEvent, ActivityTarget, SaveState} from './contract.ts'

import type {NoteId, NotesError} from '#notes/contract.ts'

export class SaveActivities extends Context.Service<SaveActivities>()('@deslop/stash/activity/server/SaveActivities', {
	make: Effect.gen(function* () {
		const apns = yield* Apns
		const runs = yield* FiberMap.make<NoteId>()
		const active = MutableHashMap.empty<
			NoteId,
			{user: UserId; token: SubscriptionRef.SubscriptionRef<Option.Option<ActivityTarget['token']>>}
		>()

		const push = Effect.fnUntraced(function* (
			target: ActivityTarget,
			event: ActivityEvent,
			state: SaveState,
			captureId: NoteId
		) {
			const now = yield* DateTime.now
			const answer = yield* apns.sendToDevice(
				target,
				'liveactivity',
				{
					aps: {
						'content-state': state,
						event,
						'stale-date': Math.floor(DateTime.toEpochSeconds(DateTime.addDuration(now, Duration.hours(2)))),
						timestamp: Math.floor(DateTime.toEpochSeconds(now)),
						...Boolean.match(event === 'start', {
							onFalse: () => ({}),
							onTrue: () => ({
								alert: {body: 'Open the saved note when it is ready.', title: `Saving ${state.title}`},
								attributes: {captureId},
								'attributes-type': 'SaveActivityAttributes',
								'input-push-token': 1
							})
						}),
						...Boolean.match(event === 'end', {
							onFalse: () => ({}),
							onTrue: () => ({'dismissal-date': Math.floor(DateTime.toEpochSeconds(now))})
						})
					}
				},
				10
			)
			if (ApnsAnswer.isAnyOf(['Accepted'])(answer)) return true
			yield* Effect.logWarning('Stash Live Activity push was not accepted', {event, status: answer.status})
			return false
		})

		return {
			register: Effect.fn('SaveActivities.register')(function* (
				user: UserId,
				captureId: NoteId,
				token: ActivityTarget['token']
			) {
				yield* pipe(
					MutableHashMap.get(active, captureId),
					Option.filter(activity => activity.user === user),
					Option.match({
						onNone: () => Effect.void,
						onSome: activity => SubscriptionRef.set(activity.token, Option.some(token))
					})
				)
			}),
			start: Effect.fn('SaveActivities.start')(function* (
				user: UserId,
				captureId: NoteId,
				initial: SaveState,
				target: ActivityTarget,
				states: Stream.Stream<SaveState, NotesError>
			) {
				if (!apns.enabled) return
				const token = yield* SubscriptionRef.make(Option.none<ActivityTarget['token']>())
				const watch = Effect.gen(function* () {
					MutableHashMap.set(active, captureId, {token, user})
					if (!(yield* push(target, 'start', initial, captureId))) return
					yield* pipe(
						states,
						Stream.zipLatest(
							pipe(
								SubscriptionRef.changes(token),
								Stream.filter(Option.isSome),
								Stream.map(value => value.value)
							)
						),
						// APNs orders activity updates by second. Coalesce changes, and never share the start's timestamp.
						Stream.debounce('1 second'),
						Stream.takeUntil(item => item[0].status !== 'organizing'),
						Stream.runForEach(item =>
							Effect.gen(function* () {
								const state = item[0]
								const recipient = {...target, token: item[1]}
								yield* push(recipient, 'update', state, captureId)
								if (state.status === 'organizing') return
								// Ending removes the Island immediately; leave the saved summary there long enough to read or tap.
								yield* Effect.sleep('45 seconds')
								yield* push(recipient, 'end', state, captureId)
							})
						)
					)
				})
				yield* FiberMap.run(
					runs,
					captureId,
					pipe(
						watch,
						Effect.timeout('2 hours'),
						Effect.ignore({log: 'Warn', message: 'Stash Live Activity could not be delivered'}),
						Effect.ensuring(Effect.sync(() => MutableHashMap.remove(active, captureId)))
					),
					{onlyIfMissing: true}
				)
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
