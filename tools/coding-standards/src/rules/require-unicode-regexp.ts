import {Array, Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {variableFromScope} from '#rules/shared.ts'

const MESSAGE = "Use the 'u' flag, or 'v' for set notation, so the pattern reads code points instead of UTF-16 units."

const compile = Option.liftThrowable((pattern: string, flags: string) => new RegExp(pattern, flags))

function unicode(flags: string) {
	return String.includes('u')(flags) || String.includes('v')(flags)
}

// `RegExp(pattern)` or `new RegExp(pattern, 'g')`: flags it cannot read stay unreported, and `new RegExp(/a/u)` keeps its literal's flags.
function checkConstructor(context: Context, node: ESTree.CallExpression | ESTree.NewExpression) {
	if (
		node.callee.type !== 'Identifier' ||
		node.callee.name !== 'RegExp' ||
		Option.exists(
			variableFromScope({name: 'RegExp', scope: context.sourceCode.getScope(node)}),
			variable => !Array.isArrayEmpty(variable.defs)
		)
	) {
		return
	}
	const flags = node.arguments[1]
	const pattern = node.arguments[0]
	if (
		(Predicate.isNullish(flags) || (flags.type === 'Identifier' && flags.name === 'undefined')) &&
		pattern?.type === 'Literal' &&
		Predicate.hasProperty(pattern, 'regex')
	) {
		return
	}
	if (Predicate.isNullish(flags)) {
		context.report({message: MESSAGE, node})
		return
	}
	if (flags.type !== 'Literal' || !Predicate.isString(flags.value) || unicode(flags.value)) return
	context.report({message: MESSAGE, node})
}

export const requireUnicodeRegexp = defineRule({
	create: context => ({
		CallExpression: node => checkConstructor(context, node),
		// A literal whose pattern still compiles with 'u' gets the flag; one that 'u' rejects, such as an escaped letter, stays for a person.
		Literal: node => {
			if (!Predicate.hasProperty(node, 'regex') || unicode(node.regex.flags)) return
			const regex = node.regex
			context.report({
				fix: fixer => {
					if (Option.isNone(compile(regex.pattern, `${regex.flags}u`))) return []
					return fixer.insertTextAfter(node, 'u')
				},
				message: MESSAGE,
				node
			})
		},
		NewExpression: node => checkConstructor(context, node)
	}),
	meta: {fixable: 'code', type: 'suggestion'}
})
