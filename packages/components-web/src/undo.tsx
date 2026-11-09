import {Effect, Schema} from 'effect'

import {ArrowCounterClockwiseIcon} from '@phosphor-icons/react'
import {Machine} from '@typeonce/effect-machine'
import type {AtomRegistry} from 'effect/reactivity'
import type {ComponentProps} from 'react'

import {Button} from '#components/ui/button.tsx'

class RemovalFailed extends Schema.TaggedError<RemovalFailed>()('RemovalFailed', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// Each app passes a commit effect with its runtime already provided, then binds its atom as Gateway does: AtomMachine.bind(RpcClient.runtime).make(removalMachine(commit)); Waiting strikes the row and shows UndoButton, Failed shows the reason.
export function removalMachine<E extends {readonly message: string}>(
	commit: (id: string) => Effect.Effect<void, E, AtomRegistry.AtomRegistry>
) {
	return Machine.make({
		branches: {committed: {idle: {target: 'Idle'}, waiting: {target: 'Waiting'}}},
		effects: {
			commit: (id: string) => Effect.mapError(commit(id), cause => RemovalFailed.make({cause, message: cause.message}))
		},
		events: Machine.events({Dismissed: {}, Removed: {id: Schema.String}, Undone: {}}),
		root: Machine.state({
			states: {
				Committing: {fields: {id: Schema.String, next: Schema.optionalKey(Schema.String)}},
				Failed: {fields: {id: Schema.String, message: Schema.String}},
				Idle: {},
				Waiting: {fields: {id: Schema.String}}
			}
		}),
		timers: {expire: '8 seconds'}
	}).handle({
		initial: {target: 'Idle'},
		states: {
			Committing: {
				invoke: {
					input: transition => transition.state.id,
					onDone: {
						branches: 'committed',
						resolve: transition => {
							if (transition.state.next === undefined) return transition.select.idle()
							return transition.select.waiting({data: {id: transition.state.next}})
						}
					},
					onFailure: {
						data: transition => ({id: transition.state.id, message: transition.error.message}),
						target: 'Failed'
					},
					src: 'commit'
				},
				on: {
					// The commit already in flight keeps its row and records the next removal.
					Removed: {
						data: transition => ({id: transition.state.id, next: transition.event.id}),
						guard: transition => transition.state.next === undefined && transition.event.id !== transition.state.id,
						update: 'Committing'
					}
				}
			},
			Failed: {on: {Dismissed: {target: 'Idle'}}},
			Idle: {on: {Removed: {data: transition => ({id: transition.event.id}), target: 'Waiting'}}},
			Waiting: {
				invoke: {onDone: {data: transition => ({id: transition.state.id}), target: 'Committing'}, src: 'expire'},
				on: {
					// Another row's removal commits this one now; this row's own repeat leaves its eight seconds running.
					Removed: {
						data: transition => ({id: transition.state.id, next: transition.event.id}),
						guard: transition => transition.event.id !== transition.state.id,
						target: 'Committing'
					},
					Undone: {target: 'Idle'}
				}
			}
		}
	})
}

// The way back from a waiting removal: the stock outline button, so the row says it the same way in every app.
export function UndoButton(props: ComponentProps<typeof Button>) {
	return (
		<Button {...props} size="sm" variant="outline">
			<ArrowCounterClockwiseIcon />
			Undo
		</Button>
	)
}
