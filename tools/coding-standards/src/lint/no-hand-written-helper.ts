import {Array, Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport, importedMember, memberName} from '#lib/ast.ts'

// The two halves a concatenation joins: `a + b`, or a template that is only `${a}${b}`.
function halves(node: ESTree.Node) {
	if (node.type === 'BinaryExpression' && node.operator === '+') return Option.some([node.left, node.right])
	if (
		node.type === 'TemplateLiteral' &&
		node.expressions.length === 2 &&
		Array.every(node.quasis, quasi => quasi.value.raw === '')
	) {
		return Option.some(node.expressions)
	}
	return Option.none()
}

function sameText(context: Context, left: ESTree.Node, right: ESTree.Node) {
	return context.sourceCode.getText(left) === context.sourceCode.getText(right)
}

function isNumber(value: number, node?: ESTree.Node) {
	return node?.type === 'Literal' && node.value === value
}

// The string a call applies a String function or a native string method to, with its other arguments: `String.name(...operands)(text)`, `String.name(text, ...operands)` or `text.name(...operands)`.
function stringCall(context: Context, node: ESTree.Node, name: string) {
	if (node.type !== 'CallExpression') return Option.none<{operands: ESTree.Node[]; text: ESTree.Node}>()
	if (
		node.callee.type === 'CallExpression' &&
		node.callee.callee.type !== 'Super' &&
		importedMember({context, importedName: 'String', node: node.callee.callee, propertyName: name})
	) {
		const operands = node.callee.arguments
		return Option.map(Array.head(node.arguments), text => ({operands, text}))
	}
	if (node.callee.type !== 'MemberExpression' || !Option.contains(memberName(node.callee), name)) return Option.none()
	if (importedMember({context, importedName: 'String', node: node.callee})) {
		const operands = Array.drop(node.arguments, 1)
		return Option.map(Array.head(node.arguments), text => ({operands, text}))
	}
	return Option.some({operands: node.arguments, text: node.callee.object})
}

// The first character of a string: `text[0]`, `text.charAt(0)` or `String.slice(0, 1)(text)`, with an optional `?? ''`.
function firstCharacterOf(context: Context, node: ESTree.Node): Option.Option<ESTree.Node> {
	if (node.type === 'LogicalExpression' && node.operator === '??') return firstCharacterOf(context, node.left)
	if (node.type === 'MemberExpression' && node.computed && isNumber(0, node.property)) return Option.some(node.object)
	return pipe(
		stringCall(context, node, 'charAt'),
		Option.filter(call => call.operands.length === 1 && isNumber(0, call.operands[0])),
		Option.orElse(() =>
			pipe(
				stringCall(context, node, 'slice'),
				Option.orElse(() => stringCall(context, node, 'substring')),
				Option.filter(
					call => call.operands.length === 2 && isNumber(0, call.operands[0]) && isNumber(1, call.operands[1])
				)
			)
		),
		Option.map(call => call.text)
	)
}

// The rest of a string after its first character: `String.slice(1)(text)` or `text.slice(1)`.
function restOf(context: Context, node: ESTree.Node) {
	return pipe(
		Option.orElse(stringCall(context, node, 'slice'), () => stringCall(context, node, 'substring')),
		Option.filter(call => call.operands.length === 1 && isNumber(1, call.operands[0])),
		Option.map(call => call.text)
	)
}

// The string whose length a node reads: `text.length` or `String.length(text)`.
function lengthOf(context: Context, node: ESTree.Node) {
	if (node.type === 'MemberExpression' && Option.contains(memberName(node), 'length')) {
		return Option.some<ESTree.Node>(node.object)
	}
	if (
		node.type === 'CallExpression' &&
		node.callee.type !== 'Super' &&
		importedMember({context, importedName: 'String', node: node.callee, propertyName: 'length'})
	) {
		return Array.head(node.arguments)
	}
	return Option.none()
}

// `String.repeat(width - text.length)(fill)` on one side of the same text.
function padsWith(context: Context, fill: ESTree.Node, text: ESTree.Node) {
	return Option.exists(stringCall(context, fill, 'repeat'), call =>
		Option.exists(
			Array.head(call.operands),
			count =>
				count.type === 'BinaryExpression' &&
				count.operator === '-' &&
				Option.exists(lengthOf(context, count.right), measured => sameText(context, measured, text))
		)
	)
}

function padded(context: Context, node: ESTree.Node) {
	return Option.exists(halves(node), parts =>
		Option.exists(
			Option.all([Array.get(parts, 0), Array.get(parts, 1)]),
			pair => padsWith(context, pair[0], pair[1]) || padsWith(context, pair[1], pair[0])
		)
	)
}

function capitalize(input: {context: Context; fixer: Fixer; node: ESTree.Node; text: ESTree.Node}) {
	return pipe(
		effectImport({context: input.context, fixer: input.fixer, name: 'String', node: input.node}),
		subject4779 =>
			Option.map(subject4779, imports =>
				Array.append(
					imports,
					input.fixer.replaceText(input.node, `String.capitalize(${input.context.sourceCode.getText(input.text)})`)
				)
			),
		subject4953 => Option.getOrElse(subject4953, () => [])
	)
}

// The compiler rejects a subtraction comparator, since an Order returns -1, 0 or 1; sums and extremes written with reduce stay with review.
export const noHandWrittenHelper = defineRule({
	create: context => {
		// `toUpperCase` of the first character joined to the rest of the same string; toLocaleUpperCase does more than String.capitalize.
		function check(node: ESTree.BinaryExpression | ESTree.TemplateLiteral) {
			Option.match(
				pipe(
					halves(node),
					Option.flatMap(parts => Option.all([Array.get(parts, 0), Array.get(parts, 1)])),
					Option.flatMap(pair =>
						pipe(
							stringCall(context, pair[0], 'toUpperCase'),
							Option.filter(call => Array.isArrayEmpty(call.operands)),
							Option.flatMap(call => firstCharacterOf(context, call.text)),
							Option.filter(text => Option.exists(restOf(context, pair[1]), rest => sameText(context, rest, text)))
						)
					)
				),
				{
					onNone: () => {
						if (padded(context, node)) context.report({message: 'Pad with String.padStart or String.padEnd.', node})
					},
					onSome: text =>
						context.report({
							fix: fixer => capitalize({context, fixer, node, text}),
							message: 'Capitalize with String.capitalize.',
							node
						})
				}
			)
		}
		return {BinaryExpression: check, TemplateLiteral: check}
	},
	meta: {fixable: 'code', type: 'problem'}
})
