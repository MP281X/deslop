import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {importedMember, memberName} from '#rules/shared.ts'

// `Effect.ignore({log: 'Warn', message})` keeps the failure in the log, so best-effort work stays visible; only a literal `log` that no spread can override counts.
function logged(node: ESTree.MemberExpression) {
	return (
		node.parent.type === 'CallExpression' &&
		node.parent.callee === node &&
		Array.some(
			node.parent.arguments,
			argument =>
				argument.type === 'ObjectExpression' &&
				Array.every(argument.properties, property => property.type === 'Property') &&
				Array.some(
					argument.properties,
					property =>
						!property.computed &&
						((property.key.type === 'Identifier' && property.key.name === 'log') ||
							(property.key.type === 'Literal' && property.key.value === 'log')) &&
						property.value.type === 'Literal' &&
						(property.value.value === true || Predicate.isString(property.value.value))
				)
		)
	)
}

export const noDiscardedFailure = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (!importedMember({context, importedName: 'Effect', node})) return
			if (
				!Option.exists(memberName(node), name => Array.contains(['ignore', 'ignoreCause', 'orDie', 'orDieWith'], name))
			) {
				return
			}
			if (Option.exists(memberName(node), name => name !== 'orDie' && name !== 'orDieWith') && logged(node)) return
			context.report({
				message:
					"Map the failure to the service's error, or log best-effort work with Effect.ignore({log: 'Warn', message}); an expected failure is never dropped silently or turned into a defect.",
				node
			})
		}
	}),
	meta: {type: 'problem'}
})
