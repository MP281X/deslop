import {Context, Effect, Option, Schema} from 'effect'

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
	branches: {inspected: {idle: {target: 'Idle'}, offered: {target: 'Offered'}}},
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
			Answering: {fields: {count: Schema.String, kind: ClipboardKind, save: Schema.Boolean}},
			Checking: {},
			Idle: {},
			Offered: {fields: {count: Schema.String, kind: ClipboardKind}}
		}
	})
}).handle({
	initial: {target: 'Idle'},
	states: {
		Answering: {invoke: {input: transition => transition.state, onDone: {target: 'Idle'}, src: 'answer'}},
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
			}
		},
		Idle: {on: {Returned: {target: 'Checking'}}},
		Offered: {
			on: {
				Answered: {
					data: transition => ({
						count: transition.state.count,
						kind: transition.state.kind,
						save: transition.event.save
					}),
					target: 'Answering'
				},
				Returned: {target: 'Checking'}
			}
		}
	}
})
