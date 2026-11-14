import {Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {bindingName, isImportBinding, matches, memberName} from '#lib/ast.ts'

const componentOrHook = matches(/^(?:[A-Z]|use[A-Z])/u)

// Atom's guards, registry operations and constants; every other member returns a new atom.
const readsOrWrites = matches(/^(?:is[A-Z]|get|set$|update$|modify$|refresh$|mount$|batch$|toStream)/u)

// The nearest component or hook around a node, which runs on every render.
function renderingFunction(node: ESTree.Node): Option.Option<ESTree.Node> {
	return Option.flatMap(Option.fromNullishOr(node.parent), parent => {
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
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.tsx': `import {useAtomValue} from '@effect/atom-react'
import {Atom} from 'effect/reactivity'
const countAtom = Atom.make(0)
export function Count() { return <span>{useAtomValue(countAtom)}</span> }`
					}
				]
			}
		},
		type: 'problem'
	}
})
