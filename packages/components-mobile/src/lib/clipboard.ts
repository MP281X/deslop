import {Boolean, Context, Effect, Option, Schema} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import type {File} from 'expo-file-system'

import {clipboardChangeCount} from '#lib/utils.ts'

// What a copy holds, as far as its metadata tells.
export type ClipboardKind = typeof ClipboardKind.Type
const ClipboardKind = Schema.Literals(['image', 'link', 'text'])

type Offered = {readonly count: string; readonly kind: ClipboardKind}
type Answer = Offered & {readonly save: boolean}

// What an app does with its clipboard; its runtime provides it to the machine.
export class ClipboardOffer extends Context.Service<
	ClipboardOffer,
	{
		// Handles the answer: keeps its count in `file` and, when asked, saves the copy.
		readonly answer: (answer: Answer) => Effect.Effect<void>
		// What the clipboard holds from its metadata alone, so iOS shows its paste banner only when the answer reads it.
		readonly detect: Effect.Effect<Option.Option<ClipboardKind>>
		readonly file: File
	}
>()('@deslop/components-mobile/lib/clipboard/ClipboardOffer') {}

// A copy is offered once: the change count it was answered at stays in the app's file, so a return offers only a newer copy.
export const clipboardMachine = Machine.make({
	branches: {
		answered: {checking: {target: 'Checking'}, idle: {target: 'Idle'}},
		inspected: {idle: {target: 'Idle'}, offered: {target: 'Offered'}}
	},
	effects: {
		answer: Effect.fnUntraced(function* (answer: Answer) {
			return yield* (yield* ClipboardOffer).answer(answer)
		}),
		inspect: Effect.gen(function* () {
			const offer = yield* ClipboardOffer
			const count = `${clipboardChangeCount()}`
			if (offer.file.exists && offer.file.textSync() === count) return Option.none<Offered>()
			return Option.map(yield* offer.detect, kind => ({count, kind}))
		})
	},
	events: Machine.events({Answered: {save: Schema.Boolean}, Returned: {}}),
	root: Machine.state({
		states: {
			// `returned` records a return during the answer, whose new copy is looked at once the answer is done.
			Answering: {fields: {count: Schema.String, kind: ClipboardKind, returned: Schema.Boolean, save: Schema.Boolean}},
			Checking: {},
			Idle: {},
			Offered: {fields: {count: Schema.String, kind: ClipboardKind}}
		}
	})
}).handle({
	initial: {target: 'Idle'},
	states: {
		Answering: {
			invoke: {
				input: transition => transition.state,
				onDone: {
					branches: 'answered',
					resolve: transition =>
						Boolean.match(transition.state.returned, {
							onFalse: () => transition.select.idle(),
							onTrue: () => transition.select.checking()
						})
				},
				src: 'answer'
			},
			on: {
				Returned: {
					data: transition => ({
						count: transition.state.count,
						kind: transition.state.kind,
						returned: true,
						save: transition.state.save
					}),
					update: 'Answering'
				}
			}
		},
		// A return while iOS suspended the inspection starts it over.
		Checking: {
			invoke: {
				onDone: {
					branches: 'inspected',
					resolve: transition =>
						Option.match(transition.output, {
							onNone: () => transition.select.idle(),
							onSome: offer => transition.select.offered({data: offer})
						})
				},
				src: 'inspect'
			},
			on: {Returned: {reenter: true, target: 'Checking'}}
		},
		Idle: {on: {Returned: {target: 'Checking'}}},
		Offered: {
			on: {
				Answered: {
					data: transition => ({
						count: transition.state.count,
						kind: transition.state.kind,
						returned: false,
						save: transition.event.save
					}),
					target: 'Answering'
				},
				Returned: {target: 'Checking'}
			}
		}
	}
})
