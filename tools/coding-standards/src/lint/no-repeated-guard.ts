import {Array, Option, Predicate, Record, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {containsNode, isFunction} from '#lib/ast.ts'

// What can change a value between two checks, or give one written expression two values.
const CHANGES = [
	'AssignmentExpression',
	'AwaitExpression',
	'CallExpression',
	'ImportExpression',
	'NewExpression',
	'TaggedTemplateExpression',
	'UpdateExpression',
	'YieldExpression'
]
const EXITS = ['BreakStatement', 'ContinueStatement', 'ReturnStatement', 'ThrowStatement']
// A comparison written with the bound first, and the numbers each comparison with a bound admits.
const FLIPPED: Record.ReadonlyRecord<string, string> = {'<': '>', '<=': '>=', '===': '===', '>': '<', '>=': '<='}
const INTERVALS: Record.ReadonlyRecord<string, (bound: number) => Omit<Interval, 'subject'>> = {
	'<': bound => ({high: bound, highOpen: true, low: -Infinity, lowOpen: true}),
	'<=': bound => ({high: bound, highOpen: false, low: -Infinity, lowOpen: true}),
	'===': bound => ({high: bound, highOpen: false, low: bound, lowOpen: false}),
	'>': bound => ({high: Infinity, highOpen: true, low: bound, lowOpen: true}),
	'>=': bound => ({high: Infinity, highOpen: true, low: bound, lowOpen: false})
}

function changes(input: {context: Context; node: ESTree.Node; throughFunctions: boolean}) {
	return containsNode({
		...input,
		matches: node =>
			Array.contains(CHANGES, node.type) ||
			(node.type === 'UnaryExpression' && node.operator === 'delete') ||
			(input.throughFunctions && isFunction(node))
	})
}

function exits(statement: ESTree.Statement): boolean {
	if (Array.contains(EXITS, statement.type)) return true
	return statement.type === 'BlockStatement' && Option.exists(Array.last(statement.body), exits)
}

// An if with no else that exits on a test that changes nothing: the code after it runs only when the test is false.
function isGuard(context: Context, statement: ESTree.Statement): statement is ESTree.IfStatement {
	return (
		statement.type === 'IfStatement' &&
		statement.alternate === null &&
		exits(statement.consequent) &&
		!changes({context, node: statement.test, throughFunctions: true})
	)
}

type Interval = {high: number; highOpen: boolean; low: number; lowOpen: boolean; subject: string}

function numberOf(node: ESTree.Node): Option.Option<number> {
	if (node.type === 'Literal' && Predicate.isNumber(node.value)) return Option.some(node.value)
	if (node.type !== 'UnaryExpression' || node.operator !== '-') return Option.none()
	return Option.map(numberOf(node.argument), value => -value)
}

// The numbers a comparison of one expression with a number literal admits: `total <= 0` admits (-∞, 0].
function intervalOf(context: Context, test: ESTree.Expression) {
	if (test.type !== 'BinaryExpression') return Option.none<Interval>()
	const boundFirst = Option.map(numberOf(test.left), bound => ({
		bound,
		operator: pipe(
			FLIPPED,
			Record.get(test.operator),
			Option.flatMap(flipped => Record.get(INTERVALS, flipped))
		),
		subject: test.right
	}))
	return pipe(
		numberOf(test.right),
		Option.map(bound => ({bound, operator: Record.get(INTERVALS, test.operator), subject: test.left})),
		Option.orElse(() => boundFirst),
		Option.flatMap(comparison =>
			Option.map(comparison.operator, interval => ({
				...interval(comparison.bound),
				subject: context.sourceCode.getText(comparison.subject)
			}))
		)
	)
}

// Every number `inner` admits, `outer` admits too; NaN fails both, so a later test inside an exited one is always false.
function within(inner: Interval, outer: Interval) {
	return (
		inner.subject === outer.subject &&
		(inner.low > outer.low || (inner.low === outer.low && (inner.lowOpen || !outer.lowOpen))) &&
		(inner.high < outer.high || (inner.high === outer.high && (inner.highOpen || !outer.highOpen)))
	)
}

// The nearest earlier guard with the same test, or a comparison admitting every number this one does, unless a statement between them can change what it reads.
function repeatsGuard(context: Context, body: ESTree.Statement[], index: number) {
	const statement = body[index]
	if (statement?.type !== 'IfStatement') return false
	const test = context.sourceCode.getText(statement.test)
	const admitted = intervalOf(context, statement.test)
	function sameGuard(previous: ESTree.Statement) {
		return (
			isGuard(context, previous) &&
			(context.sourceCode.getText(previous.test) === test ||
				Option.exists(Option.all([admitted, intervalOf(context, previous.test)]), pair => within(pair[0], pair[1])))
		)
	}
	return pipe(
		Array.reverse(Array.take(body, index)),
		Array.findFirst(
			previous =>
				sameGuard(previous) ||
				(!isGuard(context, previous) && changes({context, node: previous, throughFunctions: false}))
		),
		Option.exists(sameGuard)
	)
}

// typescript/no-unnecessary-condition owns a check the compiler narrows away; this owns a repeated or implied test it cannot narrow, such as a comparison.
export const noRepeatedGuard = defineRule({
	create: context => ({
		BlockStatement: node => {
			Array.forEach(node.body, (statement, index) => {
				if (statement.type === 'IfStatement' && repeatsGuard(context, node.body, index)) {
					context.report({
						message:
							'Delete the check; an earlier guard already exited on every value it admits, and nothing since changed what it reads.',
						node: statement.test
					})
				}
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Schema} from 'effect'
export type Port = typeof Port.Type
export const Port = Schema.Int
export function readPort(input: unknown) { return Schema.decodeUnknownSync(Port)(input) }`
					}
				]
			}
		},
		type: 'problem'
	}
})
