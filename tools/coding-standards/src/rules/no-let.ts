import {defineRule} from 'vite-plus/lint/plugins'

export const noLet = defineRule({
	create: context => ({
		VariableDeclaration: node => {
			if (node.kind === 'let') {
				context.report({
					message:
						'Replace let with const: a pipeline such as Array.map or Array.filter, Array.mapAccum for carried state, or a MutableList collector read after the loop.',
					node
				})
			}
		}
	}),
	meta: {type: 'problem'}
})
