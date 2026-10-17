import {Option, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {bindingName, isImportBinding, matches, memberName} from '#rules/shared.ts'

const componentOrHook = matches(/^(?:[A-Z]|use[A-Z])/u)

// Atom's guards, registry operations and constants; every other member returns a new atom.
const readsOrWrites = matches(/^(?:is[A-Z]|get|set$|update$|modify$|refresh$|mount$|batch$|toStream)/u)

// The nearest component or hook around a node, which runs on every render.
function renderingFunction(node: ESTree.Node): Option.Option<ESTree.Node> {
	return pipe(
		Option.fromNullishOr(node.parent),
		Option.flatMap(parent => {
			if (
				(parent.type === 'FunctionDeclaration' ||
					parent.type === 'FunctionExpression' ||
					parent.type === 'ArrowFunctionExpression') &&
				Option.exists(bindingName(parent), componentOrHook)
			) {
				return Option.some(parent)
			}
			return renderingFunction(parent)
		})
	)
}

export const noComponentAtomAllocation = defineRule({
	create: context => ({
		CallExpression: node => {
			if (
				node.callee.type !== 'MemberExpression' ||
				node.callee.object.type !== 'Identifier' ||
				node.callee.object.name !== 'Atom' ||
				!isImportBinding({context, node: node.callee.object, source: /reactivity|atom/u}) ||
				Option.exists(memberName(node.callee), readsOrWrites) ||
				Option.isNone(renderingFunction(node))
			) {
				return
			}
			context.report({
				message:
					'Declare the atom at module level, or in Atom.family keyed by the prop; an atom made during render is a new atom on every render.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
