import {Array, Option, Predicate, Schema, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {Context, ESTree} from 'vite-plus/lint/plugins'

import {
	TEST_RUNNERS,
	hasEffectMember,
	isFunction,
	isImportBinding,
	matches,
	memberName,
	optionKeys,
	resolveBinding,
	testChain
} from '#lib/ast.ts'

const MESSAGE = 'Run every test: remove this .only, .skip, .skipIf, .runIf or .fails before committing.'

type RegistrationContext = typeof RegistrationContext.Type
const RegistrationContext = Schema.Literals(['callback', 'loop', false])

// vitest/no-focused-tests and no-disabled-tests read it.only and it.skip, not @effect/vitest's it.effect.only, a layer's test.skip, a condition or an options object.
function skips(context: Context, node: ESTree.MemberExpression) {
	return Option.exists(testChain(context, node), chain =>
		Option.exists(Array.last(chain.members), last => {
			if (Array.contains(['fails', 'runIf', 'skipIf'], last)) return true
			// A runner import's plain .skip and .only are the native rules' even when renamed; everything else is this rule's.
			return (
				Array.contains(['only', 'skip'], last) &&
				(!isImportBinding({context, node: chain.root, source: TEST_RUNNERS}) || hasEffectMember(chain.members))
			)
		})
	)
}

function repeated(node: ESTree.Node): RegistrationContext {
	if (Predicate.isNullish(node.parent)) return false
	if (
		Array.contains(
			['DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement'],
			node.parent.type
		)
	) {
		return 'loop'
	}
	if (
		isFunction(node.parent) &&
		node.parent.parent?.type === 'CallExpression' &&
		node.parent.parent.callee.type === 'MemberExpression' &&
		Option.exists(memberName(node.parent.parent.callee), name =>
			Array.contains(['flatMap', 'forEach', 'from', 'makeBy', 'map'], name)
		)
	) {
		return 'callback'
	}
	return repeated(node.parent)
}

function titleOf(node: ESTree.Node) {
	if (node.type === 'Literal' && Predicate.isString(node.value)) return node.value
	if (node.type === 'TemplateLiteral') {
		return pipe(
			node.quasis,
			Array.map(quasi => quasi.value.raw),
			Array.join('')
		)
	}
	return ''
}

export const testRegistration = defineRule({
	create: context => ({
		CallExpression: node => {
			const found = testChain(context, node.callee)
			if (Option.isNone(found)) return
			const chain = Option.getOrThrow(found)
			const title = node.arguments[0]
			if (title === undefined) return
			if (
				matches(
					/\b(?:regression|no longer|anymore|legacy|previous implementation)\b|(?:#|\b(?:issue|pr|pull request)\s*#?)\d+/iu
				)(titleOf(resolveBinding(context, title)))
			) {
				context.report({
					message: 'State the current rule in the present tense; delete scenarios about superseded code.',
					node: title
				})
				return
			}
			if (
				Array.some(node.arguments, isFunction) &&
				repeated(node) !== false &&
				(hasEffectMember(chain.members) ||
					!Array.contains(['describe', 'it', 'suite', 'test'], chain.root.name) ||
					repeated(node) === 'callback')
			) {
				context.report({
					message:
						'Register independent cases with it.effect.each(cases)(title, body), not a loop or collection callback.',
					node
				})
				return
			}
			if (
				Array.some(node.arguments, isFunction) &&
				Option.isSome(testChain(context, node.callee)) &&
				Array.some(node.arguments, argument =>
					Array.some(optionKeys(argument), key => Array.contains(['fails', 'only', 'skip', 'todo'], key))
				)
			) {
				context.report({message: MESSAGE, node})
			}
		},
		MemberExpression: node => {
			if (skips(context, node)) context.report({message: MESSAGE, node: node.property})
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.test.ts': `import {assert, it} from '@effect/vitest'
function hasBudget(balance: number) { return balance > 0 }

it('refuses spending without a balance', () => { assert.isFalse(hasBudget(0)); assert.isTrue(hasBudget(2)) })`
					}
				]
			}
		},
		type: 'problem'
	}
})
