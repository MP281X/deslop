import {Boolean, Duration, Effect, Schema} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom} from 'effect/reactivity'
import {checkForUpdateAsync, fetchUpdateAsync, isEnabled, reloadAsync} from 'expo-updates'

import {activationsAtom, awayAtom} from '#mobile/activations.ts'

class UpdateError extends Schema.TaggedError<UpdateError>()('UpdateError', {
	cause: Schema.Defect(),
	message: Schema.String
}) {}

// A reload looks like a crash to someone switching apps for a moment, so a downloaded update starts on the next launch or on a return after ten minutes away.
const updates = AtomMachine.make(
	Machine.make({
		branches: {fetched: {downloaded: {target: 'Downloaded'}, idle: {target: 'Idle'}}},
		effects: {
			fetch: Effect.tapError(
				Effect.gen(function* () {
					if (
						!(yield* Effect.tryPromise({
							catch: cause => UpdateError.make({cause, message: 'The update server was not reached'}),
							try: () => checkForUpdateAsync()
						})).isAvailable
					) {
						return false
					}
					return (yield* Effect.tryPromise({
						catch: cause => UpdateError.make({cause, message: 'The update did not download'}),
						try: () => fetchUpdateAsync()
					})).isNew
				}),
				error => Effect.logWarning('The app update check failed', error)
			),
			reload: Effect.ignore(
				Effect.tryPromise({
					catch: cause => UpdateError.make({cause, message: 'The app did not reload'}),
					try: () => reloadAsync()
				}),
				{log: 'Warn', message: 'The app update did not start'}
			)
		},
		events: Machine.events({Returned: {away: Schema.Finite}}),
		root: Machine.state({states: {Checking: {}, Downloaded: {}, Idle: {}, Reloading: {}}})
	}).handle({
		initial: {target: 'Idle'},
		states: {
			Checking: {
				invoke: {
					onDone: {
						branches: 'fetched',
						resolve: transition =>
							Boolean.match(transition.output, {
								onFalse: () => transition.select.idle(),
								onTrue: () => transition.select.downloaded()
							})
					},
					onFailure: {target: 'Idle'},
					src: 'fetch'
				},
				// A return while a check hangs, such as one iOS suspended mid-download, starts it over.
				on: {Returned: {reenter: true, target: 'Checking'}}
			},
			Downloaded: {
				on: {
					Returned: {guard: transition => transition.event.away >= Duration.toMillis('10 minutes'), target: 'Reloading'}
				}
			},
			Idle: {on: {Returned: {target: 'Checking'}}},
			Reloading: {invoke: {onDone: {target: 'Downloaded'}, src: 'reload'}}
		}
	})
)

// Checks on launch and on each return from the background; mount it only where a reload loses nothing.
export const updateAtom = Atom.make(get => {
	get(activationsAtom)
	if (!isEnabled) return
	get.mount(updates.ref)
	get.set(updates.send, {_tag: 'Returned', away: get.once(awayAtom)})
})
