import {Array, MutableRef, Option, Predicate, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function
type Frame = {returns: ESTree.ReturnStatement[]}

function isExported(node: FunctionNode) {
	if (node.parent.type === 'ExportNamedDeclaration' || node.parent.type === 'ExportDefaultDeclaration') return true
	return (
		node.parent.type === 'VariableDeclarator' &&
		node.parent.parent.type === 'VariableDeclaration' &&
		node.parent.parent.parent.type === 'ExportNamedDeclaration'
	)
}

function inferredIdentically(input: {
	context: Context
	node: FunctionNode
	returns: ESTree.ReturnStatement[]
	type: ESTree.TSType
}) {
	const text = input.context.sourceCode.getText
	const body = input.node.body
	if (body === null) return false
	const block = body.type === 'BlockStatement'
	const values = body.type === 'BlockStatement' ? Array.map(input.returns, statement => statement.argument) : [body]
	const expressions = Array.filter(values, Predicate.isNotNull)
	if (input.type.type === 'TSVoidKeyword') return block && Array.isArrayEmpty(expressions)
	if (Array.isArrayEmpty(expressions) || expressions.length !== values.length) return false
	if (input.type.type === 'TSStringKeyword') {
		return Array.every(
			expressions,
			value => value.type === 'TemplateLiteral' && Array.isArrayNonEmpty(value.expressions)
		)
	}
	if (isExported(input.node)) return false
	return Array.every(
		expressions,
		value =>
			(value.type === 'TSAsExpression' && text(value.typeAnnotation) === text(input.type)) ||
			(!block &&
				value.type === 'NewExpression' &&
				input.type.type === 'TSTypeReference' &&
				input.type.typeArguments === null &&
				text(value.callee) === text(input.type.typeName))
	)
}

export const noRedundantReturnType = defineRule({
	create: context => {
		const frames = MutableRef.make(Array.empty<Frame>())
		function enter() {
			MutableRef.update(frames, Array.append({returns: Array.empty<ESTree.ReturnStatement>()}))
		}
		function exit(node: FunctionNode) {
			const frame = Array.last(MutableRef.get(frames))
			MutableRef.update(frames, Array.dropRight(1))
			if (node.async || node.generator || Predicate.isNullish(node.returnType)) return
			const returns = Option.match(frame, {
				onNone: () => Array.empty<ESTree.ReturnStatement>(),
				onSome: top => top.returns
			})
			if (inferredIdentically({context, node, returns, type: node.returnType.typeAnnotation})) {
				context.report({message: 'Drop this return type; inference gives the same type.', node: node.returnType})
			}
		}
		return {
			ArrowFunctionExpression: enter,
			'ArrowFunctionExpression:exit': exit,
			FunctionDeclaration: enter,
			'FunctionDeclaration:exit': exit,
			FunctionExpression: enter,
			'FunctionExpression:exit': exit,
			ReturnStatement: node => {
				MutableRef.update(frames, stack =>
					pipe(
						Array.last(stack),
						Option.match({
							onNone: () => stack,
							onSome: top => Array.append(Array.dropRight(stack, 1), {returns: Array.append(top.returns, node)})
						})
					)
				)
			}
		}
	},
	meta: {type: 'problem'}
})
