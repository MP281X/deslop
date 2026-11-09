import {question} from '#lib/question.ts'

export const noOneShotInterpreter = question(
	'code',
	'Does `code` describe a fixed computation as data, such as a list of steps, operations or handlers, and then interpret that data, where plain code would do the same directly?',
	{
		message: 'Write the fixed computation as plain code; drop the description and its interpreter.',
		no: {
			cases: [
				'A lookup table that maps keys to values',
				'Data that comes from outside `code`, from a user or from storage',
				'Configuration, schemas, routes, rules or state machines handed to a library',
				'A list `code` turns into one output per entry, such as rendering a list of links'
			],
			example: `
				function price(base: number) {
					return base * 0.9 * 1.2
				}
			`
		},
		yes: {
			cases: [
				'A local list of step objects or operation names run through a loop or switch that dispatches on them',
				'A table of options or handlers built in `code` with fixed contents, only to be read back in `code`'
			],
			example: `
				function price(base: number) {
					const steps = [{by: 0.1, op: 'discount'}, {by: 0.2, op: 'tax'}]
					return Array.reduce(steps, base, (total, step) =>
						step.op === 'discount' ? total * (1 - step.by) : total * (1 + step.by)
					)
				}
			`
		}
	}
)
