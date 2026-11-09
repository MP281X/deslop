import {question} from '#lib/question.ts'

export const noRepeatedSearch = question(
	'code',
	'Does `code` search the same unchanged collection by key once per item of a loop, where an index built once would do?',
	{
		message: 'Build the index once (a set, a map, or Array.groupBy) instead of searching the list for each item.',
		no: {
			cases: [
				'A lookup into a Set, Map, record or grouping built before the loop',
				'A small fixed lookup table, or a small fixed set the code or a comment in it establishes, such as two machines or a few providers',
				'Walking each item’s own children',
				'Pairwise algorithms, and collections the loop changes',
				'Code inside string literals',
				'Calls to helpers whose contents `code` does not show'
			],
			example: `
				function attach(spans: Span[], services: Service[]) {
					const byId = new Map(services.map(service => [service.id, service]))
					return spans.map(span => ({...span, service: byId.get(span.serviceId)}))
				}
			`
		},
		yes: {
			cases: [
				'Inside a loop or map over data, a find, filter, some, includes or indexOf on another unchanged collection, matching by an id or equality key'
			],
			example: `
				function attach(spans: Span[], services: Service[]) {
					return spans.map(span => ({...span, service: services.find(service => service.id === span.serviceId)}))
				}
			`
		}
	}
)
