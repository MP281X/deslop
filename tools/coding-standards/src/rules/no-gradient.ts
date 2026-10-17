import {Predicate} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {Context, ESTree} from '@oxlint/plugins'

// Tailwind gradient utilities with any variant prefix, and CSS gradient functions in class or style strings.
const gradient = /(?:^|[\s:])bg-(?:linear|radial|conic|gradient)(?:-|$|\s)|gradient\(/u

function report(context: Context, node: ESTree.Node) {
	context.report({message: 'Use a flat theme color; gradients are never part of the design.', node})
}

export const noGradient = defineRule({
	create: context => ({
		Literal: node => {
			if (Predicate.isString(node.value) && gradient.test(node.value)) report(context, node)
		},
		TemplateElement: node => {
			if (gradient.test(node.value.raw)) report(context, node)
		}
	}),
	meta: {type: 'problem'}
})
