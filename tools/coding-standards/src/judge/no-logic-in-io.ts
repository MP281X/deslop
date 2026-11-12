import {question} from '#lib/question.ts'

export const noLogicInIo = question(
	'code',
	'Does `code` work out a result or a plan in several steps in the middle of its I/O, where a pure function of the values already read could do it?',
	{
		// Several steps of calculation, amid input or output.
		gate: unit => unit.inputOutput && unit.transformations >= 2,
		message: 'Move the calculation into a pure function of the values read, and keep the I/O around it.',
		no: {
			cases: [
				'Rendering: a component deriving what it shows from props or atoms is not I/O',
				'Discovery where each read decides what to read next',
				'Orchestration that selects pending items, perhaps orders them, then calls existing operations',
				'Small projections or predicates that feed one write or pick what to clean up',
				'Decisions that need an operation’s actual outcome, such as whether to retry a send',
				'A calculation `code` already delegates to a pure helper'
			],
			example: `
				const sync = Effect.fnUntraced(function* (calendarId: string) {
					const events = yield* calendar.list(calendarId)
					const trips = yield* store.trips()
					const plan = calendarPlan(trips, events)
					yield* Effect.forEach(plan.created, entry => calendar.create(calendarId, entry))
					yield* Effect.forEach(plan.stale, event => calendar.remove(calendarId, event.id))
				})
			`
		},
		yes: {
			cases: [
				'Building a result through several dependent steps of selecting, normalizing, grouping, ranking or rendering inside a function that also reads or writes',
				'Reconciling current and incoming state into additions, replacements and removals inline with the calls that apply them'
			],
			example: `
				const sync = Effect.fnUntraced(function* (calendarId: string) {
					const events = yield* calendar.list(calendarId)
					const trips = yield* store.trips()
					const wanted = Array.flatMap(trips, trip =>
						Array.map(trip.days, day => ({date: day.date, key: day.id, title: \`\${trip.name} · day \${day.number}\`}))
					)
					const created = Array.filter(wanted, entry => !Array.some(events, event => event.key === entry.key))
					const stale = Array.filter(events, event => !Array.some(wanted, entry => entry.key === event.key))
					yield* Effect.forEach(created, entry => calendar.create(calendarId, entry))
					yield* Effect.forEach(stale, event => calendar.remove(calendarId, event.id))
				})
			`
		}
	}
)
