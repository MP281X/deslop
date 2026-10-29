import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

import {effectImport} from '#rules/shared.ts'

// Names, literals and plain property chains read nothing that could change when the two sides swap places.
function inert(node: ESTree.Node): boolean {
	if (node.type === 'Identifier' || node.type === 'Literal' || node.type === 'ThisExpression') return true
	return node.type === 'MemberExpression' && !node.computed && !node.optional && inert(node.object)
}

// `'key' in value` becomes `Predicate.hasProperty(value, 'key')`.
function fix(input: {context: Context; fixer: Fixer; node: ESTree.BinaryExpression | ESTree.PrivateInExpression}) {
	if (input.node.left.type === 'PrivateIdentifier' || !inert(input.node.left) || !inert(input.node.right)) return []
	const replacement = input.fixer.replaceText(
		input.node,
		`Predicate.hasProperty(${input.context.sourceCode.getText(input.node.right)}, ${input.context.sourceCode.getText(input.node.left)})`
	)
	return Option.getOrElse(
		Option.map(
			effectImport({context: input.context, fixer: input.fixer, name: 'Predicate', node: input.node}),
			imports => Array.append(imports, replacement)
		),
		() => []
	)
}

export const noInOperator = defineRule({
	create: context => ({
		BinaryExpression: node => {
			if (node.operator !== 'in') return
			context.report({
				fix: fixer => fix({context, fixer, node}),
				message: 'Decode the value with Schema, or narrow it with Predicate.hasProperty, instead of the in operator.',
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'problem'}
})
