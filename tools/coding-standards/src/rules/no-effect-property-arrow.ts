import {Array} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {importedMember, isImportBinding} from '#rules/shared.ts'

export const noEffectPropertyArrow = defineRule({
	create: context => ({
		Property: node => {
			if (
				node.value.type !== 'ArrowFunctionExpression' ||
				Array.isArrayEmpty(node.value.params) ||
				node.value.body.type !== 'CallExpression'
			) {
				return
			}

			if (
				(node.value.body.callee.type === 'Identifier' &&
					isImportBinding({context, importedName: 'pipe', node: node.value.body.callee, source: 'effect'}) &&
					Array.some(
						node.value.body.arguments,
						argument =>
							(argument.type !== 'SpreadElement' &&
								importedMember({context, importedName: 'Effect', node: argument})) ||
							(argument.type === 'CallExpression' &&
								importedMember({context, importedName: 'Effect', node: argument.callee}))
					)) ||
				(node.value.body.callee.type === 'MemberExpression' &&
					importedMember({context, importedName: 'Effect', node: node.value.body.callee, propertyName: 'tryPromise'}))
			) {
				context.report({message: 'Define this property with Effect.fn or Effect.fnUntraced instead of an arrow.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
