import {question} from '#lib/question.ts'

export const noSilentFallback = question('code', 'Does `code` turn a failed operation into a normal-looking value?', {
	message: 'Let the caller see that the operation failed.',
	no: {
		cases: ['A failure remains a failure.', 'Absence is a valid answer.'],
		example: `
			import {Effect} from 'effect'

			export function prices(read: Effect.Effect<number, {readonly _tag: 'PricesError'}>) {
				return Effect.result(read)
			}
		`
	},
	yes: {
		cases: ['A failed read returns plausible data.', 'Partial results look complete after a required operation fails.'],
		example: `
			import {Effect} from 'effect'

			export function prices(read: Effect.Effect<number, {readonly _tag: 'PricesError'; readonly previous: number}>) {
				return Effect.orElseSucceed(read, cause => cause.previous)
			}
		`
	}
})
