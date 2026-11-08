import {judgedRule} from '#judge/rule.ts'

export const noStaleComment = judgedRule({
	criteria: {
		false:
			'A log message or string literal is not a comment. A comment about a library DEFAULT explains why an explicit option OVERRIDES it; the two values need not match. External guarantees and imported helper behavior cannot be disproved by this unit alone.',
		true: 'An actual source comment makes a concrete claim about adjacent executable code and that code visibly does the opposite or uses a contradictory value.'
	},
	examples: {
		bad: `// Retries three times with a one second delay.
const fetchWithRetry = (request: Request) =>
	pipe(client.execute(request), Effect.retry({schedule: Schedule.exponential('200 millis'), times: 5}))`,
		good: `// Retries five times, backing off from 200 ms, since the upstream sheds load in short bursts.
const fetchWithRetry = (request: Request) =>
	pipe(client.execute(request), Effect.retry({schedule: Schedule.exponential('200 millis'), times: 5}))`
	},
	kind: 'code',
	message: 'Fix the comment or the code: the comment says something the code does not do.',
	question: 'Does an actual source comment in `code` directly contradict the adjacent implementation visible in `code`?'
})
