import {Option, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {typeWrapped} from '#rules/shared.ts'

function element(node: ESTree.Node): boolean {
	if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true
	return pipe(typeWrapped(node), Option.exists(element))
}

export const noStoredJsx = defineRule({
	create: context => ({
		VariableDeclarator: node => {
			if (node.init === null || !element(node.init)) return
			context.report({
				message: 'Write the element where it renders, or make it a component when several places render it.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
