import {
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	FiberMap,
	Function,
	Layer,
	MutableHashMap,
	Option,
	Schema,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer, ApnsToken} from '@deslop/runtime/shared/apns'
import type {UserId} from '@deslop/runtime/shared/auth'

import type {Note, NoteId, NoteItem, NotesError} from '#contracts'

type ActivityTarget = typeof ActivityTarget.Type
export const ActivityTarget = Schema.Struct({
	bundle: Schema.Literals(['xyz.mp281x.stash', 'xyz.mp281x.stash.dev']),
	token: Schema.RedactedFromValue(ApnsToken)
})

type ActivityEvent = typeof ActivityEvent.Type
const ActivityEvent = Schema.Literals(['start', 'update', 'end'])

export function saveState(note: Note | NoteItem) {
	return {
		noteId: note.id,
		source: Option.match(note.url, {onNone: Function.constant(''), onSome: url => new URL(url).hostname}),
		status: note.status,
		summary: String.slice(0, 400)(note.summary),
		title: String.slice(0, 120)(note.title)
	}
}

type SaveState = ReturnType<typeof saveState> & {readonly elapsed?: number; readonly total?: number}

export class SaveActivities extends Context.Service<SaveActivities>()(
	'@deslop/stash/server/notes/activity/SaveActivities',
	{
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
	}
) {
	static readonly layer = Layer.effect(this, this.make)
}
