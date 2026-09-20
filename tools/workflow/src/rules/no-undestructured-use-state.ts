import {defineRule} from '@oxlint/plugins'

import {isReactUseState} from './shared.ts'

export const noUndestructuredUseState = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			if (
				node.init?.type === 'CallExpression' &&
				isReactUseState({context, node: node.init}) &&
				node.id.type !== 'ArrayPattern'
			) {
				context.report({message: 'Destructure the state value and setter at the declaration.', node})
			}
		}
	}),
	meta: {type: 'problem'}
})
