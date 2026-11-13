import {Boolean, Context, Effect, Layer, Option, Schema, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom} from 'effect/reactivity'
import {requireNativeModule} from 'expo'
import {File, Paths} from 'expo-file-system'

import {activationsAtom} from '@deslop/runtime/mobile/activations'

import {alertFailure} from '#lib/alerts.ts'
import {writeAtomically} from '#lib/files.ts'

export type ClipboardKind = typeof ClipboardKind.Type
const ClipboardKind = Schema.Literals(['image', 'link', 'text'])

function clipboardChangeCount() {
	return requireNativeModule<{clipboardChangeCount: () => number}>('DeslopComponents').clipboardChangeCount()
}

export type ClipboardCopy = {readonly count: string; readonly kind: ClipboardKind}
type Answer = ClipboardCopy & {readonly save: boolean}

class ClipboardError extends Schema.TaggedError<ClipboardError>()('ClipboardError', {
	cause: pipe(Schema.OptionFromOptional(Schema.Defect()), Schema.withConstructorDefault(Effect.succeedNone)),
	message: Schema.String
}) {}

// Metadata is checked on both sides of the native read, before any save can consume a different copy.
export function readClipboard<A, E, R>(count: string, read: Effect.Effect<A, E, R>) {
	const unchanged = Effect.flatMap(
		Effect.try({
			catch: cause => ClipboardError.make({cause: Option.some(cause), message: 'The clipboard could not be checked.'}),
			try: () => `${clipboardChangeCount()}`
		}),
		current => {
			if (current === count) return Effect.void
			return ClipboardError.make({message: 'The clipboard changed. Reopen the app to save the new copy.'})
		}
	)
	return Effect.andThen(
		unchanged,
		Effect.tap(read, () => unchanged)
	)
}

class ClipboardOffer extends Context.Service<
	ClipboardOffer,
	{
		readonly answer: (answer: Answer) => Effect.Effect<void>
		// What the clipboard holds from its metadata alone, so iOS shows its paste banner only when the answer reads it.
		readonly detect: Effect.Effect<Option.Option<ClipboardKind>>
		readonly file: File
	}
>()('@deslop/components-mobile/lib/clipboard/ClipboardOffer') {}

// A copy is offered once: the change count it was answered at stays in the app's file, so a return offers only a newer copy.
const clipboardMachine = Machine.make({
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
			if (offer.file.exists && offer.file.textSync() === count) return Option.none<ClipboardCopy>()
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

export type ClipboardLabels = {
	readonly confirm: string
	readonly notSaved: string
	readonly questions: Record<ClipboardKind, string>
}

export type Clipboard = ReturnType<typeof makeClipboard>

// A copy is offered once: the count file, its write, the answer and the return listener are the same in every app; `answered` names the failed saves that must not offer the same copy again.
export function makeClipboard<E extends {_tag: string; message: string}>(options: {
	answered: (error: E) => boolean
	detect: Effect.Effect<Option.Option<ClipboardKind>>
	labels: ClipboardLabels
	save: (copy: ClipboardCopy, context: Atom.AtomContext) => Effect.Effect<void, E>
}) {
	const file = new File(Paths.document, 'clipboard.txt')
	const atom = AtomMachine.bind(
		Atom.runtime(get =>
			Layer.succeed(
				ClipboardOffer,
				ClipboardOffer.of({
					answer: Effect.fnUntraced(function* (answer) {
						const handled = Effect.try({
							catch: cause =>
								ClipboardError.make({
									cause: Option.some(cause),
									message: 'The answer could not be kept on this iPhone.'
								}),
							try: () => writeAtomically(file, answer.count)
						})
						const save: Effect.Effect<void, E> = Boolean.match(answer.save, {
							onFalse: () => Effect.void,
							onTrue: () => options.save(answer, get)
						})
						yield* pipe(
							save,
							Effect.tapError(error =>
								Boolean.match(options.answered(error), {onFalse: () => Effect.void, onTrue: () => handled})
							),
							Effect.andThen(handled),
							alertFailure(options.labels.notSaved),
							Effect.ignore({log: 'Warn', message: 'The clipboard copy was not saved'})
						)
					}),
					detect: options.detect,
					file
				})
			)
		)
	).make(clipboardMachine)
	const returnsAtom = Atom.make(get => {
		get(activationsAtom)
		get.set(atom.send, {_tag: 'Returned'})
	})
	return {atom, labels: options.labels, returnsAtom}
}
