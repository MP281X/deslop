import {String} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {matches} from '#lib/ast.ts'

// A directive is its whole first word: `oxlint-disablement` is prose.
const DISABLE = /^\s*(?:(?:eslint|oxlint)-disable(?:-next-line|-line)?|@effect-diagnostics(?:-next-line)?)(?:\s|$)/u

export const noUnexplainedDisable = defineRule({
	create: context => ({
		Program: () => {
			for (const comment of context.sourceCode.getAllComments()) {
				if (matches(DISABLE)(comment.value) && matches(/\bsort-keys\b/u)(String.split(comment.value, ' -- ')[0])) {
					context.report({
						message: 'Sort the keys, starting a new sorted group after a blank line; never disable sort-keys.',
						node: comment
					})
				} else if (matches(DISABLE)(comment.value) && !matches(/\s--\s*\S/u)(comment.value)) {
					context.report({message: 'Give this disable a `-- reason`.', node: comment})
				}
			}
		}
	}),
	meta: {
		docs: {
			examples: {
				accepted: [
					{
						'sample.tsx': `// oxlint-disable-next-line eslint/eqeqeq -- This external contract deliberately groups both missing forms.
export function isMissing(value: unknown) { return value == null }`
					}
				]
			}
		},
		type: 'problem'
	}
})
