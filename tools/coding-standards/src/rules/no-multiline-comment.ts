import {Array, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {matches} from '#rules/shared.ts'

function adjacentLines(first?: ESTree.Comment, second?: ESTree.Comment) {
	return first?.type === 'Line' && second?.type === 'Line' && second.loc.start.line === first.loc.end.line + 1
}

export const noMultilineComment = defineRule({
	create: context => ({
		Program: () => {
			const comments = pipe(
				context.sourceCode.getAllComments(),
				Array.filter(
					comment =>
						!matches(/^\s*(?:eslint|oxlint|@effect-diagnostics|@ts-|\/\s*<reference|#region|#endregion)/u)(
							comment.value
						)
				)
			)
			pipe(
				comments,
				Array.filter(
					(comment, index) =>
						(adjacentLines(comment, comments[index + 1]) && !adjacentLines(comments[index - 1], comment)) ||
						(comment.type === 'Block' && String.includes('\n')(String.trim(comment.value)))
				),
				Array.forEach(comment =>
					context.report({
						message:
							'Keep one short line that states an outside constraint, or delete the comment and rename or split the code; joining the lines into one long line is not a fix.',
						node: comment
					})
				)
			)
		}
	}),
	meta: {type: 'suggestion'}
})
