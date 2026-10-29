import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport, memberName} from '#rules/shared.ts'

const MESSAGE = 'Use standalone pipe: pipe(value, f, g) instead of value.pipe(f, g).'

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

// The source between a call's parentheses, comments included.
function argumentsText(context: Context, node: ESTree.CallExpression) {
	const open = context.sourceCode.getTokenAfter(node.callee)
	if (open === null) return ''
	return String.trim(String.slice(open.range[1], node.range[1] - 1)(context.sourceCode.text))
}

// `value.pipe(f).pipe(g)` becomes one `pipe(value, f, g)`.
function fix(input: {context: Context; fixer: Fixer; node: PipeCall}) {
	const calls = chain(input.node)
	if (Array.some(calls, call => Array.some(call.arguments, argument => argument.type === 'SpreadElement'))) return []
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
						`pipe(${Array.join([input.context.sourceCode.getText(innermost.callee.object), ...steps], ', ')})`
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
