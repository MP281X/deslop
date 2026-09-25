import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'

import {memberName} from './shared.ts'

export const noErrorMessageAssertion = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type === 'MemberExpression' &&
				Option.exists(memberName(node.callee), name => Array.contains(['toThrow', 'toThrowError'], name)) &&
				(node.arguments[0]?.type === 'Literal' || node.arguments[0]?.type === 'TemplateLiteral')
			) {
				context.report({message: 'Assert the failure, never its message wording.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
