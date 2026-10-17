import {Array, Option} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

import {replaceableGuard} from '#rules/no-hand-written-guard.ts'
import {variableFor} from '#rules/shared.ts'

function enclosingFunction(node: ESTree.Node): Option.Option<ESTree.Function | ESTree.ArrowFunctionExpression> {
	if (
		node.type === 'ArrowFunctionExpression' ||
		node.type === 'FunctionDeclaration' ||
		node.type === 'FunctionExpression'
	) {
		return Option.some(node)
	}
	return Option.flatMap(Option.fromNullishOr(node.parent), enclosingFunction)
}

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
			// no-hand-written-guard replaces the whole guard.
			if (Option.exists(enclosingFunction(node), fn => Option.isSome(replaceableGuard(fn)))) return
			context.report({
				message:
					'Replace typeof with its Predicate guard: Predicate.isString, isNumber, isBoolean, isFunction, isObject or isUndefined.',
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
