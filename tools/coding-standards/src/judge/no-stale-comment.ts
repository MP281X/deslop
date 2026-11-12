import {question} from '#lib/question.ts'

export const noStaleComment = question(
	'code',
	'Does a comment inside `code` state something the code next to it visibly contradicts?',
	{
		gate: unit => unit.comment,
		message: 'Fix the comment or the code: the comment says something the code does not do.',
		no: {
			cases: [
				'String literals and log messages',
				'A comment about a library default that explains why the code overrides it',
				'Claims about imported helpers or external systems, which `code` does not show'
			],
			example: `
				function fetchWithRetry(request: Request) {
					// Retries five times, since the upstream sheds load in short bursts.
					return Effect.retry(client.execute(request), {times: 5})
				}
			`
		},
		yes: {
			cases: [
				'A comment naming a value, count, order or behavior that the code next to it does differently, such as "retries three times" above times: 5'
			],
			example: `
				function fetchWithRetry(request: Request) {
					// Retries three times.
					return Effect.retry(client.execute(request), {times: 5})
				}
			`
		}
	}
)
