import {Array, Function, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, memberName, readsOf, resolveBinding, variableFromScope} from '#lib/ast.ts'

const NONE: RetryPolicy = {bound: false, cadence: false, predicate: false}

// A cadence spaces attempts but never ends them; only a count, a duration limit or a time budget does.
type RetryPolicy = {bound: boolean; cadence: boolean; predicate: boolean}

function either(policies: readonly RetryPolicy[]) {
	return {
		bound: Array.some(policies, value => value.bound),
		cadence: Array.some(policies, value => value.cadence),
		predicate: Array.some(policies, value => value.predicate)
	}
}

// Combinators that continue while any of their schedules continues end only when every one of them ends.
function both(policies: RetryPolicy[]) {
	return {...either(policies), bound: Array.isArrayNonEmpty(policies) && Array.every(policies, value => value.bound)}
}

function returnedValues(statements: readonly ESTree.Statement[]): ESTree.Node[] {
	return Array.flatMap(statements, statement => {
		if (statement.type === 'ReturnStatement') return Option.toArray(Option.fromNullishOr(statement.argument))
		if (statement.type === 'BlockStatement') return returnedValues(statement.body)
		if (statement.type === 'IfStatement') {
			return [
				...returnedValues([statement.consequent]),
				...Option.match(Option.fromNullishOr(statement.alternate), {
					onNone: () => [],
					onSome: alternate => returnedValues([alternate])
				})
			]
		}
		return []
	})
}

// A schedule builder ends only if every value it can return ends.
function callbackPolicy(
	node: ESTree.ArrowFunctionExpression | ESTree.Function,
	read: (node: ESTree.Node) => RetryPolicy
) {
	if (node.body === null) return NONE
	if (node.body.type === 'BlockStatement') return both(Array.map(returnedValues(node.body.body), read))
	return read(node.body)
}

function withinBudget(context: Context, node: ESTree.Node) {
	if (node.parent?.type !== 'CallExpression') return false
	if (importedMember({context, importedName: 'Effect', node: node.parent.callee, propertyName: 'timeout'})) {
		return node.parent.arguments[0] === node && node.parent.arguments.length === 2
	}
	if (
		node.parent.callee.type !== 'Identifier' ||
		!isImportBinding({context, importedName: 'pipe', node: node.parent.callee, source: 'effect'})
	) {
		return false
	}
	return pipe(
		node.parent.arguments,
		Array.dropWhile(argument => argument !== node),
		Array.drop(1),
		Array.some(
			argument =>
				argument.type === 'CallExpression' &&
				argument.arguments.length === 1 &&
				importedMember({context, importedName: 'Effect', node: argument.callee, propertyName: 'timeout'})
		)
	)
}

// A retry bound to a name is budgeted when every read of that name runs under a timeout.
function budgeted(context: Context, node: ESTree.CallExpression) {
	if (withinBudget(context, node)) return true
	if (
		node.parent.type !== 'VariableDeclarator' ||
		node.parent.init !== node ||
		node.parent.id.type !== 'Identifier' ||
		node.parent.parent.type !== 'VariableDeclaration' ||
		node.parent.parent.kind !== 'const'
	) {
		return false
	}
	return Option.exists(
		readsOf({context, name: node.parent.id.name, node: node.parent}),
		reads => Array.isArrayNonEmpty(reads) && Array.every(reads, read => withinBudget(context, read.identifier))
	)
}

function scheduleCall(node: ESTree.CallExpression, read: (node: ESTree.Node) => RetryPolicy) {
	const name = pipe(
		node.callee,
		Option.liftPredicate(callee => callee.type === 'MemberExpression'),
		Option.flatMap(memberName),
		Option.getOrElse(Function.constant(''))
	)
	const parts = Array.flatMap(node.arguments, argument => {
		if (argument.type === 'ArrayExpression') {
			return pipe(argument.elements, Array.filter(Predicate.isNotNull), Array.map(read))
		}
		return [read(argument)]
	})
	if (Array.contains(['recurs', 'during', 'upTo'], name)) return {...either(parts), bound: true}
	if (Array.contains(['spaced', 'fixed', 'exponential', 'fibonacci', 'windowed', 'cron'], name)) {
		return {...either(parts), cadence: true}
	}
	if (name === 'while') return {...either(parts), predicate: true}
	if (Array.contains(['min', 'concat'], name)) return both(parts)
	return either(parts)
}

function optionPolicy(
	property: ESTree.ObjectExpression['properties'][number],
	read: (node: ESTree.Node) => RetryPolicy
) {
	if (property.type === 'SpreadElement') return read(property.argument)
	const name = {value: ''}
	if (property.key.type === 'Identifier') name.value = property.key.name
	if (property.key.type === 'Literal' && Predicate.isString(property.key.value)) name.value = property.key.value
	if (name.value === 'times') return {...NONE, bound: true}
	if (name.value === 'schedule') return read(property.value)
	return {...NONE, predicate: Array.contains(['while', 'until'], name.value)}
}

function callPolicy(context: Context, node: ESTree.CallExpression, read: (node: ESTree.Node) => RetryPolicy) {
	if (importedMember({context, importedName: 'Schedule', node: node.callee})) return scheduleCall(node, read)
	if (node.callee.type !== 'Identifier') return NONE
	// A builder's own parameter, as `$` in `Stream.retry(stream, $ => …)`, only types the schedule it receives.
	const builder = Option.exists(
		variableFromScope({name: node.callee.name, scope: context.sourceCode.getScope(node)}),
		variable => Array.some(variable.defs, definition => definition.type === 'Parameter')
	)
	if (builder || isImportBinding({context, importedName: 'pipe', node: node.callee, source: 'effect'})) {
		return either(Array.map(node.arguments, read))
	}
	const callee = resolveBinding(context, node.callee)
	if (callee === node.callee) return NONE
	return read(callee)
}

// Follow named policies, builders and piped schedules; a call this cannot see into bounds nothing.
function policy(context: Context, node: ESTree.Node, seen: readonly ESTree.Node[] = []): RetryPolicy {
	if (Array.contains(seen, node)) return NONE
	const next = [...seen, node]
	function read(child: ESTree.Node) {
		return policy(context, child, next)
	}
	if (node.type === 'Identifier') {
		const resolved = resolveBinding(context, node)
		if (resolved === node) return NONE
		return read(resolved)
	}
	if (node.type === 'MemberExpression') {
		return {...NONE, bound: importedMember({context, importedName: 'Schedule', node, propertyName: 'once'})}
	}
	if (node.type === 'ObjectExpression') {
		return either(Array.map(node.properties, property => optionPolicy(property, read)))
	}
	if (node.type === 'CallExpression') return callPolicy(context, node, read)
	if (
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionExpression' ||
		node.type === 'FunctionDeclaration'
	) {
		return callbackPolicy(node, read)
	}
	return NONE
}

export const retryPolicy = defineRule({
	create: context => ({
		CallExpression: node => {
			const transient =
				node.callee.type === 'MemberExpression' &&
				Option.contains(memberName(node.callee), 'retryTransient') &&
				node.callee.object.type === 'Identifier' &&
				isImportBinding({context, importedName: 'HttpClient', node: node.callee.object, source: 'effect/http'})
			if (
				!transient &&
				!Array.some(['Effect', 'Stream'], importedName =>
					importedMember({context, importedName, node: node.callee, propertyName: 'retry'})
				)
			) {
				return
			}
			// A stream subscription reopens for its whole lifetime, so a cadence is its bound; a request needs an end.
			const subscription = importedMember({context, importedName: 'Stream', node: node.callee, propertyName: 'retry'})
			if (
				Option.exists(Array.last(node.arguments), value => {
					const found = policy(context, value)
					return (
						(found.bound || (subscription && found.cadence) || budgeted(context, node)) &&
						(transient || found.predicate)
					)
				})
			) {
				return
			}
			context.report({
				message:
					'Name retryable failures with while/until and end the retry with times, Schedule.recurs, Schedule.upTo, Schedule.during or a timeout around it; a cadence such as Schedule.spaced alone retries forever. Use HttpClient.retryTransient for HTTP.',
				node
			})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.ts': `import {Effect} from 'effect'
export const retried = Effect.retry(Effect.fail('offline'), {times: 2, while: error => error === 'offline'})`
					},
					{
						'sample.ts': `import {Effect, Schedule, Stream, pipe} from 'effect'
import {HttpClient} from 'effect/http'

declare const work: Effect.Effect<void, string>
const schedule = Schedule.while(Schedule.spaced('1 second'), metadata => metadata.input === 'offline')
export const reopened = Stream.retry(Stream.fromEffect(work), schedule)
export const budget = pipe(work, Effect.retry({while: error => error === 'offline'}), Effect.timeout('10 seconds'))
export const http = HttpClient.retryTransient({schedule: Schedule.exponential('1 second'), times: 2})`
					}
				]
			}
		},
		type: 'problem'
	}
})
