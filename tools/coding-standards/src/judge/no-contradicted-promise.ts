import {question} from '#lib/question.ts'

export const noContradictedPromise = question(
	'code',
	'Does a name or comment in `code` promise something the code beside it does differently?',
	{
		message: 'Make the promise and the code agree.',
		no: {
			cases: ['The name describes the value returned.', 'The comment agrees with the adjacent code.'],
			example: `
				export function secondsOf(milliseconds: number) {
					return milliseconds / 1000
				}
			`
		},
		yes: {
			cases: [
				'The returned value contradicts its name.',
				'A comment describes a different operation from the adjacent code.'
			],
			example: `
				export function secondsOf(milliseconds: number) {
					return milliseconds * 1000
				}
			`
		}
	}
)
