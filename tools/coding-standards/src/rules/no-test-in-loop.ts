import {Array, Option, Predicate} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {hasEffectMember, isFunction, memberName, testChain} from '#rules/shared.ts'

const MESSAGE =
	'Register one test per case with .each(cases), such as it.effect.each(cases)(name, …); a loop hides the cases from the runner and from a focused rerun.'

const LOOPS = ['DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement']

// A callback that runs once per element, such as the one `Array.forEach(cases, …)`, `Array.makeBy(3, …)` or `cases.map(…)` receives.
function iterates(node: ESTree.Node) {
	return (
		node.parent?.type === 'CallExpression' &&
		Array.some(node.parent.arguments, argument => argument === node) &&
		node.parent.callee.type === 'MemberExpression' &&
		Option.exists(memberName(node.parent.callee), name =>
			Array.contains(['flatMap', 'forEach', 'from', 'makeBy', 'map'], name)
		)
	)
}

// Where a registration repeats: inside a loop of its own function, or in a per-element callback.
function repetition(node: ESTree.Node): Option.Option<'callback' | 'loop'> {
	if (Predicate.isNullish(node.parent)) return Option.none()
	if (Array.contains(LOOPS, node.parent.type)) return Option.some('loop')
	if (isFunction(node.parent)) return Option.as(Option.liftPredicate(node.parent, iterates), 'callback' as const)
	return repetition(node.parent)
}

// vitest/prefer-each reports vitest's own registrations in a loop, but not `it.effect(…)`, a layer's tests or a per-element callback.
export const noTestInLoop = defineRule({
	create: context => ({
		CallExpression: node => {
			if (!Array.some(node.arguments, isFunction)) return
			if (
				Option.exists(testChain(context, node.callee), chain =>
					Option.exists(
						repetition(node),
						where =>
							where === 'callback' ||
							hasEffectMember(chain.members) ||
							!Array.contains(['describe', 'it', 'suite', 'test'], chain.root.name)
					)
				)
			) {
				context.report({message: MESSAGE, node})
			}
		}
	}),
	meta: {type: 'problem'}
})
