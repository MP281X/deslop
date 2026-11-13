import {question} from '#lib/question.ts'

export const noVagueName = question(
	'code',
	'Does `code` name a function, or a value used across several lines, only with a generic word such as data, result, info, item, value, obj, temp, handle, process, manager or helper, where `code` shows what it means?',
	{
		message: 'Name it for what it means in the domain.',
		no: {
			cases: [
				'Parameters of one-line callbacks',
				'Generic utilities whose values really are generic',
				'Conventional names: props, ref, error, cause, request, response, event, key, index',
				'Names a library or framework requires',
				'A factory named for the domain object it returns, such as a process handle',
				'Domain nouns naming the returned value, such as history(samples)',
				'A service public lib/utils.ts: the filename describes its public boundary'
			],
			example: `
				function paidTotals(invoices: Invoice[]) {
					const paid = Array.filter(invoices, invoice => invoice.paid)
					return Array.map(paid, invoice => invoice.total)
				}
			`
		},
		yes: {
			cases: [
				'A variable named data, result, res, info, value or temp holding what `code` shows to be notes, prices or sessions',
				'A function named handle, process, doWork or helper whose body shows one specific job',
				'An exported function, constant, component or module named only a verb, adjective or generic noun, such as live, layer, make, run, config, guard, status, compact, summary, describe or utils, where importers see the bare name',
				'A file named utils outside a service public boundary whose contents have a specific domain'
			],
			example: `
				function process(data: Invoice[]) {
					const result = Array.filter(data, invoice => invoice.paid)
					return Array.map(result, invoice => invoice.total)
				}
			`
		}
	}
)
