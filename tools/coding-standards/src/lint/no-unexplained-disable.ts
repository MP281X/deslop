import {Array, Option, Record, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'

import {matches} from '#lib/ast.ts'
import {JUDGE_DIRECTIVE, JUDGE_IGNORE} from '#lib/question.ts'
import {QUESTIONS} from '#lib/questions.ts'

// A directive is its whole first word: `oxlint-disablement` is prose.
const DISABLE = /^\s*(?:(?:eslint|oxlint)-disable(?:-next-line|-line)?|@effect-diagnostics(?:-next-line)?)(?:\s|$)/u

export const noUnexplainedDisable = defineRule({
	// judge-ignore no-unrelated-jobs -- This lint visitor enforces comment escape-hatch contracts together, rather than visiting every comment separately for each policy.
	create: context => ({
		Program: () => {
			for (const comment of context.sourceCode.getAllComments()) {
				if (matches(JUDGE_DIRECTIVE)(comment.value)) {
					pipe(
						comment.value,
						String.match(JUDGE_IGNORE),
						Option.flatMap(match => Array.get(match, 1)),
						Option.match({
							onNone: () => context.report({message: 'Write judge-ignore <question> -- <reason>.', node: comment}),
							onSome: name => {
								if (!Array.contains(Record.keys(QUESTIONS), name)) {
									context.report({message: 'Name an existing judge question in judge-ignore.', node: comment})
								}
							}
						})
					)
				}
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
