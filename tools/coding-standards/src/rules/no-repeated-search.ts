import {judgedRule} from '#judge/rule.ts'

export const noRepeatedSearch = judgedRule({
	criteria: {
		false:
			"A lookup into a Set, HashSet, Map, record or grouping built before the iteration is the index itself, never a violation. Code examples inside string literals are data, not executable scans. Fixed small lookup tables, nested traversal of each item's own children, pairwise algorithms, collections changed by each iteration, or opaque helper calls are not evidence of a reusable index.",
		true: 'For each item in a data-sized collection the code visibly searches the same unchanged other collection by an equality key or membership relationship that can be indexed once, preserving first-match and reference semantics.'
	},
	examples: {
		bad: `function attach(spans: Span[], services: Service[]) {
	return spans.map(span => {
		const service = services.find(candidate => candidate.id === span.serviceId)
		const children = spans.filter(child => child.parentId === span.id)
		return {...span, service, children}
	})
}`,
		good: `function attach(spans: Span[], services: Service[]) {
	const byId = new Map(services.map(service => [service.id, service]))
	const children = Array.groupBy(spans, span => span.parentId ?? '')
	return spans.map(span => ({...span, service: byId.get(span.serviceId), children: children[span.id] ?? []}))
}`
	},
	kind: 'code',
	message:
		'Build the index once (a set for membership, a map for lookup, Array.groupBy for one-to-many) instead of searching the list for each item.',
	question:
		'Does `code` repeatedly scan the same unchanged collection for an indexable key relationship inside an iteration over data?'
})
