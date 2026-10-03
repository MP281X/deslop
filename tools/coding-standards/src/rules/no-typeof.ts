import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'

import {variableFor} from '#rules/shared.ts'

export const noTypeof = defineRule({
	create: context => ({
		UnaryExpression: node => {
			if (node.operator !== 'typeof') return
			if (
				node.argument.type === 'Identifier' &&
				!Option.exists(variableFor(context, node.argument), variable => Array.isArrayNonEmpty(variable.defs))
			) {
				return
			}
			context.report({message: 'Replace typeof with a Predicate guard such as Predicate.isString.', node})
		}
	}),
	meta: {type: 'problem'}
})
