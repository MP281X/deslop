import {question} from '#lib/question.ts'

export const noRedundantCheck = question(
	'code',
	'Does `code` check a condition that an earlier visible check already guarantees, for the same unchanged value on the same path, where the compiler needs no further narrowing?',
	{
		message: 'Delete the check; earlier code already guarantees it.',
		no: {
			cases: [
				'A check repeated inside a callback, where TypeScript does not carry the earlier narrowing across',
				'A check after a search or predicate whose result type does not keep the refinement',
				'A presence check after an earlier guard that still allowed the value to be absent',
				'A check of a value that may have changed since, such as after a call, an await or a yield',
				'Conditions only callers or imported code guarantee, which `code` does not show',
				'Checks of different nodes, properties or levels of a structure that look alike'
			],
			example: `
				function discount(order: Order) {
					if (order.total <= 0) return 0
					const rate = order.total > 100 ? 0.1 : 0.05
					return order.total * rate
				}
			`
		},
		yes: {
			cases: [
				'Validating input a second time after `code` already decoded it into its type',
				'Checking again for a case an earlier early return in `code` already excluded, for the same value'
			],
			example: `
				function discount(order: Order) {
					if (order.total <= 0) return 0
					const rate = order.total > 100 ? 0.1 : 0.05
					if (order.total <= 0) return 0
					return order.total * rate
				}
			`
		}
	}
)
