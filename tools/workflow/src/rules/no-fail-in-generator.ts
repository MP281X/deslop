import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

import {effectBuilderName, importedMember} from './shared.ts'

function insideEffectGenerator(input: {context: Context; node: ESTree.Node}): boolean {
	if (input.node.type === 'Program') return false
	if (
		(input.node.type === 'ArrowFunctionExpression' ||
			input.node.type === 'FunctionDeclaration' ||
			input.node.type === 'FunctionExpression') &&
		!input.node.generator
	) {
		return false
	}
	if (
		input.node.type === 'FunctionExpression' &&
		input.node.generator &&
		input.node.parent.type === 'CallExpression' &&
		Option.exists(effectBuilderName({context: input.context, node: input.node.parent.callee}), name =>
			Array.contains(['fn', 'fnUntraced', 'gen'], name)
		)
	) {
		return true
	}
	return insideEffectGenerator({context: input.context, node: input.node.parent})
}

export const noFailInGenerator = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type === 'MemberExpression' &&
				importedMember({context, importedName: 'Effect', node: node.callee, propertyName: 'fail'}) &&
				insideEffectGenerator({context, node}) &&
				!(node.parent.type === 'YieldExpression' && node.parent.delegate && node.arguments[0]?.type === 'NewExpression')
			) {
				context.report({message: 'Yield the error instead: return yield* E.make(...).', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
