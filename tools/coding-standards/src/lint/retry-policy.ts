import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding, memberName, variableFromScope} from '#lib/ast.ts'

type RetryPolicy = {bound: boolean; predicate: boolean}

function combine(policies: readonly RetryPolicy[]) {
	return {bound: Array.some(policies, value => value.bound), predicate: Array.some(policies, value => value.predicate)}
}

// Schedule callbacks may return an expression or a block of policy-building statements.
function callbackPolicy(
	node: ESTree.ArrowFunctionExpression | ESTree.Function,
	read: (node: ESTree.Node) => RetryPolicy
) {
	if (node.body === null) return {bound: false, predicate: false}
	if (node.body.type === 'BlockStatement') return combine(Array.map(node.body.body, read))
	return read(node.body)
}

function withinBudget(context: Context, node: ESTree.CallExpression) {
	if (node.parent.type !== 'CallExpression') return false
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

// Follow named policies as well as inline, piped and callback-composed schedules.
function policy(context: Context, node: ESTree.Node, seen: readonly ESTree.Node[] = []): RetryPolicy {
	if (Array.contains(seen, node)) return {bound: false, predicate: false}
	const next = [...seen, node]
	if (node.type === 'Identifier') {
		return Option.match(variableFromScope({name: node.name, scope: context.sourceCode.getScope(node)}), {
			onNone: () => ({bound: false, predicate: false}),
			onSome: variable =>
				combine(
					Array.flatMap(variable.defs, definition => {
						if (definition.node.type !== 'VariableDeclarator' || definition.node.init === null) return []
						return [policy(context, definition.node.init, next)]
					})
				)
		})
	}
	if (node.type === 'ObjectExpression') {
		return combine(
			Array.map(node.properties, property => {
				if (property.type === 'SpreadElement') return policy(context, property.argument, next)
				const name = {value: ''}
				if (property.key.type === 'Identifier') name.value = property.key.name
				if (property.key.type === 'Literal' && Predicate.isString(property.key.value)) name.value = property.key.value
				const nested = policy(context, property.value, next)
				return {
					bound: Array.contains(['times', 'schedule', 'elapsed'], name.value) || nested.bound,
					predicate: Array.contains(['while', 'until'], name.value) || nested.predicate
				}
			})
		)
	}
	if (node.type === 'CallExpression') {
		const schedule = importedMember({context, importedName: 'Schedule', node: node.callee})
		const name = pipe(
			node.callee,
			Option.liftPredicate(callee => callee.type === 'MemberExpression'),
			Option.flatMap(memberName)
		)
		return combine([
			{
				bound:
					schedule &&
					Option.exists(name, value =>
						Array.contains(['spaced', 'fixed', 'recurs', 'take', 'elapsed', 'exponential', 'upTo'], value)
					),
				predicate:
					schedule &&
					Option.exists(name, value => Array.contains(['while', 'until', 'whileInput', 'untilInput'], value))
			},
			...Array.map(node.arguments, argument => policy(context, argument, next))
		])
	}
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
		return callbackPolicy(node, body => policy(context, body, next))
	}
	if (node.type === 'BlockStatement') {
		return combine(Array.map(node.body, statement => policy(context, statement, next)))
	}
	if (node.type === 'ReturnStatement' && node.argument !== null) return policy(context, node.argument, next)
	return {bound: false, predicate: false}
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
			if (
				Option.exists(Array.last(node.arguments), value => {
					const found = policy(context, value)
					return (found.bound || withinBudget(context, node)) && (transient || found.predicate)
				})
			) {
				return
			}
			context.report({
				message:
					'Name retryable failures with while/until and a bound (times, schedule or time budget); use HttpClient.retryTransient for HTTP.',
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
