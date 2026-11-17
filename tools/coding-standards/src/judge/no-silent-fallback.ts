import {question} from '#lib/question.ts'

export const noSilentFallback = question('code', 'Does `code` turn a failed operation into a normal-looking value?', {
	message: 'Let the caller see that the operation failed.',
	no: {
		cases: [
			'A failure remains a failure, including an explicit error result, error response or failure state beside retained data.',
			'A background job logs a failure without supplying replacement data or claiming success; its next round can try again.',
			'A rejected validation/filter candidate or missing optional value is not an operation failure: an invalid optional link may remain plain text and missing metadata may be omitted. Absence is a valid answer, such as zero for an empty percentile sample or false for an invalid public-IP candidate.',
			'The failure is logged and only optional enrichment or best-effort cleanup is dropped: tapError(log…) then Effect.option, Effect.ignore({log}), or Effect.catch(… logWarning …). Required reads and writes still fail; a log alone does not make a required result optional.'
		],
		example: `
			import {Effect, pipe} from 'effect'

			export function note(text: string, preview: Effect.Effect<string, {readonly _tag: 'PreviewError'}>) {
				return pipe(
					preview,
					Effect.tapError(error => Effect.logWarning('Optional preview unavailable', error)),
					Effect.option,
					Effect.map(picture => ({text, picture}))
				)
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
