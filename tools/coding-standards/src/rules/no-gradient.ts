import {Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

// Tailwind gradient utilities with any variant prefix, and CSS gradient functions in class or style strings.
const GRADIENT = /(?:^|[\s:])bg-(?:linear|radial|conic|gradient)(?:-|$|\s)|gradient\(/u

function report(context: Context, node: ESTree.Node) {
	context.report({
		message: 'Use a flat theme token such as bg-card or bg-muted; gradients are never part of the design.',
		node
	})
}

export const noGradient = defineRule({
	create: context => ({
		Literal: node => {
			if (Predicate.isString(node.value) && GRADIENT.test(node.value)) report(context, node)
		},
		TemplateElement: node => {
			if (GRADIENT.test(node.value.raw)) report(context, node)
		}
	}),
	meta: {type: 'problem'}
})
