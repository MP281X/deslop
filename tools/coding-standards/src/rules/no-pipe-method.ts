import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport, isImportBinding, memberName} from '#rules/shared.ts'

const MESSAGE = 'Use standalone pipe: pipe(value, f, g) instead of value.pipe(f, g).'

const EFFECT_SOURCE = /^(?:effect|@effect\/)/u

type PipeCall = ESTree.CallExpression & {callee: ESTree.MemberExpression}

function pipeMember(node: ESTree.Node): node is ESTree.MemberExpression {
	return node.type === 'MemberExpression' && Option.contains(memberName(node), 'pipe')
}

function pipeCall(node: ESTree.Node): node is PipeCall {
	return (
		node.type === 'CallExpression' &&
		!node.optional &&
		Predicate.isNullish(node.typeArguments) &&
		pipeMember(node.callee) &&
		!node.callee.optional &&
		node.callee.object.type !== 'Super'
	)
}

// The calls of `value.pipe(f).pipe(g)`, innermost first.
function chain(node: PipeCall): PipeCall[] {
	if (pipeCall(node.callee.object)) return Array.append(chain(node.callee.object), node)
	return [node]
}

// The source between a call's parentheses, comments included and a trailing comma left out.
function argumentsText(context: Context, node: ESTree.CallExpression) {
	const open = context.sourceCode.getTokenAfter(node.callee)
	if (open === null) return ''
	function text(start: number, end: number) {
		return String.slice(start, end)(context.sourceCode.text)
	}
	return String.trim(
		Option.match(
			Option.flatMap(Array.last(node.arguments), last =>
				Option.filter(Option.fromNullishOr(context.sourceCode.getTokenAfter(last)), token => token.value === ',')
			),
			{
				onNone: () => text(open.range[1], node.range[1] - 1),
				onSome: comma => `${text(open.range[1], comma.range[0])}${text(comma.range[1], node.range[1] - 1)}`
			}
		)
	)
}

// A member of a namespace imported from Effect, such as `Effect.map` or `Schema.decode`.
function effectMember(context: Context, node: ESTree.Node): boolean {
	if (node.type !== 'MemberExpression' || node.computed) return false
	if (node.object.type === 'MemberExpression') return effectMember(context, node.object)
	return node.object.type === 'Identifier' && isImportBinding({context, node: node.object, source: EFFECT_SOURCE})
}

// A function, or an Effect operator such as `Effect.map(f)`: steps that make the call a function pipe, not a Node stream's.
function operator(context: Context, node: ESTree.Node) {
	if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return true
	if (node.type === 'CallExpression') return effectMember(context, node.callee)
	return effectMember(context, node)
}

// Building it runs nothing of the program's own, so it may move ahead of an earlier step.
function inert(context: Context, node: ESTree.Node): boolean {
	if (
		node.type === 'Literal' ||
		node.type === 'Identifier' ||
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionExpression'
	) {
		return true
	}
	if (node.type === 'MemberExpression') return effectMember(context, node)
	return (
		node.type === 'CallExpression' &&
		effectMember(context, node.callee) &&
		Array.every(node.arguments, argument => inert(context, argument))
	)
}

function rewritable(context: Context, calls: PipeCall[]) {
	const steps = Array.flatMap(calls, call => call.arguments)
	return (
		Array.every(steps, step => operator(context, step)) &&
		// `value.pipe(f).pipe(make())` applies f before make() runs; one flat pipe would evaluate make() first.
		Array.every(Array.drop(calls, 1), call => Array.every(call.arguments, argument => inert(context, argument))) &&
		// `Schema.withDecodingDefaultKey(Effect.succeed('group'))` keeps its literal only when the receiver's type is known first.
		!Array.some(
			steps,
			step =>
				step.type === 'CallExpression' &&
				Array.some(
					step.arguments,
					argument =>
						argument.type === 'CallExpression' && Array.some(argument.arguments, inner => inner.type === 'Literal')
				)
		)
	)
}

// `(first(), value).pipe(f)` keeps its parentheses as an argument.
function receiverText(context: Context, node: ESTree.Expression) {
	if (node.type === 'SequenceExpression') return `(${context.sourceCode.getText(node)})`
	return context.sourceCode.getText(node)
}

// `value.pipe(f).pipe(g)` becomes one `pipe(value, f, g)`.
function fix(input: {context: Context; fixer: Fixer; node: PipeCall}) {
	const calls = chain(input.node)
	if (!rewritable(input.context, calls)) return []
	const steps = Array.filter(
		Array.map(calls, call => argumentsText(input.context, call)),
		text => String.isNonEmpty(text)
	)
	return Option.getOrElse(
		Option.flatMap(Array.head(calls), innermost =>
			Option.map(effectImport({context: input.context, fixer: input.fixer, name: 'pipe', node: input.node}), imports =>
				Array.append(
					imports,
					input.fixer.replaceTextRange(
						input.node.range,
						`pipe(${Array.join([receiverText(input.context, innermost.callee.object), ...steps], ', ')})`
					)
				)
			)
		),
		() => []
	)
}

export const noPipeMethod = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!pipeMember(node)) return
			const call = node.parent
			if (!pipeCall(call) || call.callee !== node) {
				context.report({message: MESSAGE, node})
				return
			}
			// The outermost call of a chain rewrites the whole chain; the inner ones go with it.
			if (
				call.parent?.type === 'MemberExpression' &&
				Predicate.isNotNullish(call.parent.parent) &&
				pipeCall(call.parent.parent)
			) {
				context.report({message: MESSAGE, node})
				return
			}
			context.report({fix: fixer => fix({context, fixer, node: call}), message: MESSAGE, node})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
