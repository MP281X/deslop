import {question} from '#lib/question.ts'

export const noUnrelatedJobs = question('code', 'Does `code` do two jobs that use none of each other’s values?', {
	message: 'Split it into one function per job.',
	no: {
		cases: ['Steps of one job pass values along.', 'A dispatcher selects the requested job.'],
		example: `
			import {Console, Effect} from 'effect'

			export const save = Effect.fnUntraced(function* (index: Effect.Effect<number>) {
				const words = yield* index
				yield* Console.log(words, words > 100)
			})
		`
	},
	yes: {
		cases: ['Separate parts serve different purposes and share no results.'],
		example: `
			import {Effect, Ref} from 'effect'

			export const saveNote = Effect.fnUntraced(function* (
				note: string,
				store: (text: string) => Effect.Effect<void>,
				visits: Ref.Ref<number>
			) {
				yield* store(note)
				yield* Ref.set(visits, 0)
			})
		`
	}
})
