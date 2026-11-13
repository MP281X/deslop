import {Array, Boolean, Option, Predicate, String, pipe} from 'effect'

import type {Argument, CallExpression, JSXElementName, JSXMemberExpressionObject, Node} from 'oxc-parser'
import {parseSync, visitorKeys} from 'oxc-parser'

import {matches} from '#lib/ast.ts'

const FUNCTIONS = ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression']
const LOOPS = ['DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement']
// Calls that run a callback once per item.
const ITERATIONS = [
	'all',
	'containsWith',
	'countBy',
	'dedupeWith',
	'dropWhile',
	'each',
	'every',
	'exists',
	'filter',
	'filterMap',
	'find',
	'findFirst',
	'findFirstIndex',
	'findIndex',
	'findLast',
	'findLastIndex',
	'flatMap',
	'flatMapNullable',
	'forEach',
	'getSomes',
	'groupBy',
	'iterate',
	'loop',
	'makeBy',
	'map',
	'mapAccum',
	'mapEffect',
	'mapWithIndex',
	'partition',
	'partitionMap',
	'reduce',
	'reduceRight',
	'runForEach',
	'scan',
	'some',
	'sort',
	'sortBy',
	'sortWith',
	'span',
	'takeWhile',
	'toSorted'
]
// Calls that look items up in a collection.
const SEARCHES = [
	'contains',
	'containsWith',
	'countBy',
	'dedupeWith',
	'difference',
	'differenceWith',
	'every',
	'exists',
	'filter',
	'filterMap',
	'find',
	'findFirst',
	'findFirstIndex',
	'findIndex',
	'findLast',
	'findLastIndex',
	'includes',
	'indexOf',
	'intersection',
	'intersectionWith',
	'lastIndexOf',
	'partition',
	'some',
	'union',
	'unionWith'
]
// Calls that change a collection or a reference in place.
const MUTATIONS = [
	'add',
	'append',
	'appendAll',
	'assign',
	'clear',
	'decrement',
	'delete',
	'getAndUpdate',
	'increment',
	'incrementAndGet',
	'insert',
	'modify',
	'modifyAt',
	'prepend',
	'prependAll',
	'push',
	'remove',
	'set',
	'setAndGet',
	'setUnsafe',
	'splice',
	'unsafeSet',
	'unshift',
	'update',
	'updateAndGet'
]
// Modules whose functions compute values rather than run effects.
const NAMESPACES = [
	'Array',
	'Base64',
	'Base64Url',
	'BigDecimal',
	'BigInt',
	'Boolean',
	'Brand',
	'Cause',
	'Chunk',
	'Cron',
	'Data',
	'DateTime',
	'Duration',
	'Either',
	'Encoding',
	'Equal',
	'Exit',
	'Function',
	'Graph',
	'Hash',
	'HashMap',
	'HashSet',
	'Iterable',
	'Json',
	'List',
	'Match',
	'MutableHashMap',
	'MutableHashSet',
	'MutableList',
	'Number',
	'Option',
	'Order',
	'Predicate',
	'Record',
	'Redacted',
	'Result',
	'Schema',
	'SortedMap',
	'SortedSet',
	'String',
	'Struct',
	'Trie',
	'Tuple',
	'Url'
]
// Calls besides the iterations that turn one value into another.
const TRANSFORMATIONS = [
	'chunksOf',
	'compact',
	'concat',
	'dedupe',
	'difference',
	'drop',
	'dropRight',
	'endsWith',
	'entries',
	'flatten',
	'fromEntries',
	'getOrElse',
	'head',
	'intersection',
	'join',
	'keys',
	'last',
	'mapKeys',
	'mapValues',
	'match',
	'max',
	'min',
	'padEnd',
	'padStart',
	'replace',
	'replaceAll',
	'reverse',
	'slice',
	'split',
	'startsWith',
	'sumAll',
	'take',
	'takeRight',
	'toEntries',
	'toLowerCase',
	'toUpperCase',
	'trim',
	'union',
	'values',
	'zip',
	'zipWith'
]
// Names that reach outside the process: Effect's effectful modules, the browser's and the phone's.
const INPUT_OUTPUT =
	/^(?:Channel|ChildProcess|Clipboard|Clock|Console|Deferred|Effect|Fiber|FileSystem|FileSystemLegacy|Haptics|HttpClient|HttpClientRequest|HttpClientResponse|HttpServerResponse|KeyValueStore|Latch|Layer|Linking|Mailbox|Notifications|PubSub|Queue|Reactivity|Ref|Registry|Schedule|Scope|SecureStore|Semaphore|Sink|Stream|SubscriptionRef|SynchronizedRef|document|fetch|localStorage|navigator|sessionStorage|window)$/u
const INPUT_OUTPUT_CALLS =
	/^(?:close|create\w*|delete|dispatch|emit|exec|execute|fetch\w*|fix\w*|getScope|getText|insert\w*|invalidate\w*|kill|listen|load\w*|log\w*|mutate|navigate|notify\w*|open\w*|patch|persist\w*|post|publish|push|put|read\w*|refresh|remove\w*|replace\w*|report|request\w*|run[A-Z]?\w*|save\w*|schedule\w*|send|set|set[A-Z]\w*|spawn|start\w*|stop\w*|subscribe|sync\w*|then|track|upload\w*|upsert\w*|write\w*)$/u
const STATE_HOOKS =
	/^use(?:ActionState|Atom|AtomSet|Effect|InsertionEffect|LayoutEffect|Optimistic|Reducer|Ref|State|SyncExternalStore)$/u
const PRESSABLE_NAMES = /button|pressable|touchable|link|^a$|action|chip|toggle|menuitem/iu
const PRESSABLE_ATTRIBUTES = /^(?:href|on(?:Activate|Click|MouseDown|PointerDown|Press|Select)|to)$/u
const TAB_ELEMENTS = /Tab(?!le)|Segment|tab(?!le)/u
const ASSERTION_SOURCES =
	/from ['"](?:vitest|@effect\/vitest(?:\/utils)?|vite-plus\/test|node:assert(?:\/strict)?|assert)['"]/u
const EXACT_MATCHERS =
	/^(?:assertEquals|assertFailure|assertLeft|assertRight|assertSome|assertSuccess|deepEqual|deepStrictEqual|equal|include|includeMembers|lengthOf|match|sameDeepMembers|sameMembers|sameOrderedMembers|strictEqual|toBe|toContain|toEqual|toHaveLength|toMatch|toStrictEqual)$/u

// A unit read alone the way Jev reads it: a function parses in parentheses, an example's statement as it is and a method only inside an object; JSX only as TSX and a generic arrow `<T>() =>` only as TS.
const WRAPPINGS = Array.flatMap(
	[(text: string) => `(${text})`, (text: string) => text, (text: string) => `({m${text}})`],
	wrap => Array.map(['unit.tsx', 'unit.ts'], name => ({name, wrap}))
)
const METHOD = {name: 'unit.ts', wrap: (text: string) => `({m${text}})`}

type Visit = {depth: number; node: Node; parent: Option.Option<Node>}

function isNode(value: unknown): value is Node {
	return Predicate.hasProperty(value, 'type') && Predicate.isString(value.type)
}

function childrenOf(node: Node) {
	return Array.flatMap(visitorKeys[node.type] ?? [], key => {
		if (!Predicate.hasProperty(node, key)) return []
		return Array.filter(Array.ensure(node[key]), isNode)
	})
}

function descendants(node: Node): Node[] {
	return [node, ...Array.flatMap(childrenOf(node), descendants)]
}

// Every node below `node`, `depth` counting the functions around it, the unit's own included.
function visits(node: Node, depth: number): Visit[] {
	return Array.flatMap(childrenOf(node), child => [
		{depth, node: child, parent: Option.some(node)},
		...visits(
			child,
			pipe(FUNCTIONS, Array.contains(child.type), Boolean.match({onFalse: () => depth, onTrue: () => depth + 1}))
		)
	])
}

function parse(wrapping: {name: string; wrap: (text: string) => string}, text: string) {
	const source = wrapping.wrap(text)
	return {result: parseSync(wrapping.name, source), source}
}

function calleeName(callee: Node): Option.Option<string> {
	if (callee.type === 'ChainExpression') return calleeName(callee.expression)
	if (callee.type === 'Identifier') return Option.some(callee.name)
	if (callee.type === 'CallExpression') return calleeName(callee.callee)
	if (callee.type !== 'MemberExpression') return Option.none()
	if (callee.property.type === 'Identifier' && !callee.computed) return Option.some(callee.property.name)
	if (callee.property.type === 'Literal' && Predicate.isString(callee.property.value)) {
		return Option.some(callee.property.value)
	}
	return Option.none()
}

function namespaceOf(callee: Node): Option.Option<string> {
	if (callee.type === 'CallExpression') return namespaceOf(callee.callee)
	if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') return Option.some(callee.object.name)
	return Option.none()
}

function jsxName(name: JSXElementName | JSXMemberExpressionObject): string {
	if (name.type === 'JSXMemberExpression') return `${jsxName(name.object)}.${jsxName(name.property)}`
	if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`
	return name.name
}

// A value written out in the code: a literal, or an array or object of literals.
function isExactLiteral(node: Node): boolean {
	if (node.type === 'Literal') return true
	if (node.type === 'TemplateLiteral') return Array.isArrayEmpty(node.expressions)
	if (node.type === 'UnaryExpression') return isExactLiteral(node.argument)
	if (node.type === 'Identifier') return node.name === 'undefined'
	if (node.type === 'ArrayExpression') {
		return Array.every(node.elements, element => Predicate.isNotNull(element) && isExactLiteral(element))
	}
	if (node.type === 'ObjectExpression') {
		return Array.every(
			node.properties,
			property => property.type === 'Property' && !property.computed && isExactLiteral(property.value)
		)
	}
	return false
}

// Empty values (0, '', [], {}), booleans and null are what code that did nothing tends to return, so they pin no outcome.
function pinsOutcome(node: Node): boolean {
	if (node.type === 'Literal') {
		return Predicate.isNotNull(node.value) && !Predicate.isBoolean(node.value) && node.value !== 0 && node.value !== ''
	}
	if (node.type === 'TemplateLiteral') return Array.some(node.quasis, quasi => String.isNonEmpty(quasi.value.raw))
	if (node.type === 'UnaryExpression') return pinsOutcome(node.argument)
	if (node.type === 'ArrayExpression') {
		return pipe(node.elements, Array.filter(Predicate.isNotNull), Array.some(pinsOutcome))
	}
	if (node.type === 'ObjectExpression') {
		return Array.some(node.properties, property => property.type === 'Property' && pinsOutcome(property.value))
	}
	return false
}

// `expect(actual).toBe(expected)` is one assertion holding both values.
function assertionArguments(node: CallExpression): Argument[] {
	if (node.callee.type === 'MemberExpression' && node.callee.object.type === 'CallExpression') {
		return [...assertionArguments(node.callee.object), ...node.arguments]
	}
	return node.arguments
}

function chainRoot(node: Node): Node {
	if (node.type === 'MemberExpression') return chainRoot(node.object)
	if (node.type === 'CallExpression') return chainRoot(node.callee)
	return node
}

// One compared value that holds two computed sides, such as `assert.isTrue(a === b)`.
function comparesComputed(node: Node) {
	return Array.some(descendants(node), inner => {
		if (inner.type === 'BinaryExpression') {
			return (
				matches(/^(?:===|!==|==|!=|<|>|<=|>=)$/u)(inner.operator) &&
				!isExactLiteral(inner.left) &&
				!isExactLiteral(inner.right)
			)
		}
		return inner.type === 'CallExpression' && Array.countBy(inner.arguments, argument => !isExactLiteral(argument)) >= 2
	})
}

// What the judge's gates read of a unit: only what Jev reads too, its code and the imports it uses.
export type Features = ReturnType<typeof features>

export function features(text: string, imports: string) {
	// A unit comes from a file that parsed and an example is written to parse, so one wrapping parses without errors; the method wrapping, last, is read as it parses.
	const parsed = pipe(
		WRAPPINGS,
		Array.findFirst(wrapping =>
			Option.liftPredicate(parse(wrapping, text), found => Array.isArrayEmpty(found.result.errors))
		),
		Option.getOrElse(() => parse(METHOD, text))
	)
	const all = visits(parsed.result.program, 0)

	const calls = Array.flatMap(all, visit => {
		if (visit.node.type !== 'CallExpression') return []
		return [{...visit, name: calleeName(visit.node.callee), node: visit.node}]
	})
	// `Array.contains` passed by reference to `Array.filter` is a call too.
	const references = Array.flatMap(all, visit => {
		if (visit.node.type !== 'MemberExpression' || visit.node.object.type !== 'Identifier') return []
		if (!Array.contains(NAMESPACES, visit.node.object.name)) return []
		const node = visit.node
		if (Option.exists(visit.parent, parent => parent.type === 'CallExpression' && parent.callee === node)) return []
		return [calleeName(node)]
	})
	function called(names: readonly string[]) {
		return Array.some(calls, call => Option.exists(call.name, name => Array.contains(names, name)))
	}
	const loops = Array.countBy(all, visit => Array.contains(LOOPS, visit.node.type))
	const mutates =
		called(MUTATIONS) ||
		Array.some(
			all,
			visit =>
				visit.node.type === 'UpdateExpression' ||
				(visit.node.type === 'AssignmentExpression' &&
					(visit.node.operator !== '=' || visit.node.left.type === 'MemberExpression'))
		)
	const assertionNames = pipe(
		String.split(imports, '\n'),
		Array.filter(matches(ASSERTION_SOURCES)),
		Array.flatMap(line => Option.toArray(String.match(/\{([^}]*)\}/u)(line))),
		Array.flatMap(found => Option.toArray(Array.get(found, 1))),
		Array.flatMap(String.split(/\W+/u)),
		Array.filter(String.isNonEmpty)
	)
	// The outer call of `expect(actual).toBe(expected)` is the assertion, not `expect(actual)`.
	const assertions = Array.filter(calls, call => {
		const root = chainRoot(call.node.callee)
		return (
			root.type === 'Identifier' &&
			Array.contains(['assert', 'expect', ...assertionNames], root.name) &&
			!Option.exists(call.parent, parent => parent.type === 'MemberExpression' && parent.object === call.node)
		)
	})
	const pressables = Array.flatMap(all, visit => {
		if (visit.node.type !== 'JSXOpeningElement') return []
		const pressable =
			matches(PRESSABLE_NAMES)(jsxName(visit.node.name)) ||
			Array.some(
				visit.node.attributes,
				attribute =>
					attribute.type === 'JSXAttribute' &&
					attribute.name.type === 'JSXIdentifier' &&
					matches(PRESSABLE_ATTRIBUTES)(attribute.name.name)
			)
		if (!pressable) return []
		return [visit]
	})
	return {
		assertions: assertions.length,
		// A conditional or logical expression, which can render one tree or another.
		branches: Array.some(
			all,
			visit => visit.node.type === 'ConditionalExpression' || visit.node.type === 'LogicalExpression'
		),
		comment: Array.isArrayNonEmpty(parsed.result.comments),
		// An assertion comparing two computed values, which can both come from the code under test.
		comparesComputed: Array.some(assertions, assertion => {
			const values = assertionArguments(assertion.node)
			return (
				Array.countBy(values, value => !isExactLiteral(value)) >= 2 ||
				(values.length === 1 && Array.some(values, comparesComputed))
			)
		}),
		// An assertion whose expected value is written out once and pins an outcome.
		exactExpectation: Array.some(assertions, assertion => {
			const values = assertionArguments(assertion.node)
			return (
				values.length >= 2 &&
				Option.exists(calleeName(assertion.node.callee), matches(EXACT_MATCHERS)) &&
				pipe(
					values,
					Array.drop(1),
					Array.some(
						value =>
							isExactLiteral(value) &&
							pinsOutcome(value) &&
							String.split(parsed.source, String.slice(value.start, value.end)(parsed.source)).length === 2
					)
				)
			)
		}),
		hooks: Array.some(
			calls,
			call => call.node.callee.type === 'Identifier' && matches(/^use(?:[A-Z]\w*)?$/u)(call.node.callee.name)
		),
		imports,
		// Input or output: a yield or await, an effectful module, an I/O-named call or a write.
		inputOutput:
			mutates ||
			Array.some(
				all,
				visit =>
					visit.node.type === 'YieldExpression' ||
					visit.node.type === 'AwaitExpression' ||
					(visit.node.type === 'Identifier' && matches(INPUT_OUTPUT)(visit.node.name))
			) ||
			Array.some(calls, call => Option.exists(call.name, matches(INPUT_OUTPUT_CALLS))),
		iterates: loops > 0 || called(ITERATIONS),
		jsx: Array.some(all, visit => visit.node.type === 'JSXElement' || visit.node.type === 'JSXFragment'),
		mutates,
		// Pressables inside a function within the unit, such as a row rendered per item.
		nestedPressables: Array.countBy(pressables, visit => visit.depth > 1),
		pressables: pressables.length,
		// The unit's own returns, not its callbacks'.
		returns: Array.countBy(all, visit => visit.node.type === 'ReturnStatement' && visit.depth === 1),
		searches:
			called(SEARCHES) || Array.some(references, name => Option.exists(name, found => Array.contains(SEARCHES, found))),
		stateHooks: Array.some(calls, call => Option.exists(call.name, matches(STATE_HOOKS))),
		tabHandlers: Array.some(all, visit => {
			if (visit.node.type !== 'JSXOpeningElement') return false
			const attributes = Array.filter(visit.node.attributes, attribute => attribute.type === 'JSXAttribute')
			const tab =
				matches(TAB_ELEMENTS)(jsxName(visit.node.name)) ||
				Array.some(
					attributes,
					attribute =>
						attribute.name.type === 'JSXIdentifier' &&
						attribute.name.name === 'role' &&
						attribute.value?.type === 'Literal' &&
						attribute.value.value === 'tab'
				)
			return (
				tab &&
				Array.some(
					attributes,
					attribute => attribute.name.type === 'JSXIdentifier' && matches(/^on[A-Z]/u)(attribute.name.name)
				)
			)
		}),
		text,
		// Steps that compute a value: arithmetic, templates, value-module and collection calls, loops.
		transformations:
			loops +
			references.length +
			Array.countBy(
				all,
				visit =>
					(visit.node.type === 'BinaryExpression' && matches(/^[-+*/%]$|\*\*/u)(visit.node.operator)) ||
					(visit.node.type === 'TemplateLiteral' && Array.isArrayNonEmpty(visit.node.expressions))
			) +
			Array.countBy(
				calls,
				call =>
					Option.exists(namespaceOf(call.node.callee), namespace => Array.contains(NAMESPACES, namespace)) ||
					Option.exists(call.name, name => Array.contains(ITERATIONS, name) || Array.contains(TRANSFORMATIONS, name))
			)
	}
}
