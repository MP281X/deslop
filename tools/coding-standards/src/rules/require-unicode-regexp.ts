import {Option, Predicate, String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

const MESSAGE = "Use the 'u' flag, or 'v' for set notation, so the pattern reads code points instead of UTF-16 units."

const compile = Option.liftThrowable((pattern: string, flags: string) => new RegExp(pattern, flags))

function unicode(flags: string) {
	return String.includes('u')(flags) || String.includes('v')(flags)
}

// `RegExp(pattern)` or `new RegExp(pattern, 'g')`: flags it cannot read stay unreported.
function checkConstructor(context: Context, node: ESTree.CallExpression | ESTree.NewExpression) {
	if (node.callee.type !== 'Identifier' || node.callee.name !== 'RegExp') return
	const flags = node.arguments[1]
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
