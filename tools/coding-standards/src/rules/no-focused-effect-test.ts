import {Array, Option} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {memberName} from '#rules/shared.ts'

// vitest/no-focused-tests and no-disabled-tests read it.only and it.skip, not @effect/vitest's it.effect.only, or test.scoped.skip inside it.layer.
export const noFocusedEffectTest = defineRule({
	create: context => ({
		MemberExpression: node => {
			if (
				node.object.type !== 'MemberExpression' ||
				!Option.exists(memberName(node.object), name =>
					Array.contains(['effect', 'live', 'prop', 'scoped', 'scopedLive'], name)
				) ||
				!Option.exists(memberName(node), name => Array.contains(['only', 'skip'], name))
			) {
				return
			}
			context.report({message: 'Run every test: remove this .only or .skip before committing.', node: node.property})
		}
	}),
	meta: {type: 'problem'}
})
