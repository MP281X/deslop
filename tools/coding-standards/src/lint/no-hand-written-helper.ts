import {Array, Option, Predicate, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {containsNode, effectImport, importedMember, memberName} from '#lib/ast.ts'

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
		Option.map(imports =>
			Array.append(
				imports,
				input.fixer.replaceText(input.node, `String.capitalize(${input.context.sourceCode.getText(input.text)})`)
			)
		),
		Option.getOrElse(() => [])
	)
}

// `(total, item) => total + amount` with `amount` never reading `total`: one addition per item, which Number.sumAll makes from 0 in the same order.
function summand(context: Context, callback: ESTree.Node) {
	if (callback.type !== 'ArrowFunctionExpression' || callback.params.length !== 2) return Option.none()
	const total = callback.params[0]
	const item = callback.params[1]
	const body = callback.body
	if (total?.type !== 'Identifier' || item?.type !== 'Identifier') return Option.none()
	if (body.type !== 'BinaryExpression' || body.operator !== '+') return Option.none()
	const totalName = total.name
	function isTotal(node: ESTree.Node) {
		return node.type === 'Identifier' && node.name === totalName
	}
	return pipe(
		body.right,
		Option.liftPredicate(() => isTotal(body.left)),
		Option.orElse(() => Option.liftPredicate(body.left, () => isTotal(body.right))),
		Option.filter(
			added =>
				added.type !== 'Literal' && !containsNode({context, matches: isTotal, node: added, throughFunctions: true})
		),
		Option.map(added => ({amount: added, item: item.name}))
	)
}

function sum(context: Context, node: ESTree.CallExpression) {
	if (
		node.callee.type === 'Super' ||
		!importedMember({context, importedName: 'Array', node: node.callee, propertyName: 'reduce'})
	) {
		return
	}
	const message = 'Sum with Number.sumAll of the mapped amounts instead of adding them in a reduce from 0.'
	if (node.arguments.length < 2 || node.arguments.length > 3) return
	// The seed and the callback close both forms: `Array.reduce(items, 0, add)` and the curried `Array.reduce(0, add)`.
	const seed = node.arguments[node.arguments.length - 2]
	const callback = node.arguments[node.arguments.length - 1]
	if (!isNumber(0, seed) || Predicate.isUndefined(callback)) return
	Option.match(summand(context, callback), {
		onNone: () => undefined,
		onSome: found => {
			const items = node.arguments[0]
			// A curried step in a pipe has no one-step replacement, so only the data-first form is rewritten.
			if (node.arguments.length === 2 || Predicate.isUndefined(items)) {
				context.report({message, node})
				return
			}
			context.report({
				fix: fixer =>
					pipe(
						effectImport({context, fixer, name: 'Number', node}),
						Option.map(imports =>
							Array.append(
								imports,
								fixer.replaceText(
									node,
									`Number.sumAll(Array.map(${context.sourceCode.getText(items)}, ${found.item} => ${context.sourceCode.getText(found.amount)}))`
								)
							)
						),
						Option.getOrElse(() => [])
					),
				message,
				node
			})
		}
	})
}

// The compiler rejects a subtraction comparator, since an Order returns -1, 0 or 1; extremes written with reduce from a floor stay with review, since Array.max has no floor.
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
		return {BinaryExpression: check, CallExpression: node => sum(context, node), TemplateLiteral: check}
	},
	meta: {fixable: 'code', type: 'problem'}
})
