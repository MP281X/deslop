import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree, Fixer} from 'vite-plus/lint/plugins'

// `c ? a : d ? b : e` as its branches: each test with its value, then the final value.
function branches(node: ESTree.ConditionalExpression): {
	tests: ESTree.ConditionalExpression[]
	last: ESTree.Expression
} {
	if (node.alternate.type !== 'ConditionalExpression') return {last: node.alternate, tests: [node]}
	const rest = branches(node.alternate)
	return {last: rest.last, tests: Array.prepend(rest.tests, node)}
}

// A returned value becomes an early return per branch: `return c ? a : b` is `if (c) return a` then `return b`.
function returns(context: Context, node: ESTree.ConditionalExpression) {
	const chain = branches(node)
	if (Array.some(chain.tests, test => test.consequent.type === 'ConditionalExpression')) return []
	return [
		...Array.map(
			chain.tests,
			test => `if (${context.sourceCode.getText(test.test)}) return ${context.sourceCode.getText(test.consequent)}`
		),
		`return ${context.sourceCode.getText(chain.last)}`
	]
}

function inStatementList(node: ESTree.Node) {
	return (
		node.parent?.type === 'BlockStatement' || node.parent?.type === 'StaticBlock' || node.parent?.type === 'SwitchCase'
	)
}

function fix(input: {context: Context; fixer: Fixer; node: ESTree.ConditionalExpression}) {
	const statements = returns(input.context, input.node)
	if (Array.isArrayEmpty(statements)) return []
	if (input.node.parent.type === 'ReturnStatement' && inStatementList(input.node.parent)) {
		return input.fixer.replaceText(input.node.parent, Array.join(statements, '\n'))
	}
	if (input.node.parent.type !== 'ArrowFunctionExpression' || input.node.parent.body !== input.node) return []
	// From the arrow on, so parentheses round the body go too.
	const arrow = input.context.sourceCode.getTokenBefore(input.node, {filter: token => token.value === '=>'})
	if (arrow === null) return []
	return input.fixer.replaceTextRange(
		[arrow.range[1], input.node.parent.range[1]],
		` {\n${Array.join(statements, '\n')}\n}`
	)
}

export const noTernary = defineRule({
	create: context => ({
		ConditionalExpression: node => {
			// The outermost conditional of a chain rewrites the whole chain.
			const outermost = !(node.parent.type === 'ConditionalExpression' && node.parent.alternate === node)
			context.report({
				fix: fixer => {
					if (!outermost) return []
					return fix({context, fixer, node})
				},
				message: 'Branch with if statements and early returns, Option.match or Match instead of a ternary expression.',
				node
			})
		}
	}),
	meta: {fixable: 'code', type: 'suggestion'}
})
