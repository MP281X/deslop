import {Array, String, pipe} from 'effect'

import {defineRule} from 'vite-plus/lint/plugins'
import type {ESTree} from 'vite-plus/lint/plugins'

import {matches} from '#rules/shared.ts'

function adjacentLines(pair: {first?: ESTree.Comment; second?: ESTree.Comment}) {
	return (
		pair.first?.type === 'Line' &&
		pair.second?.type === 'Line' &&
		pair.second.loc.start.line === pair.first.loc.end.line + 1
	)
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
						(adjacentLines({first: comment, second: comments[index + 1]}) &&
							!adjacentLines({first: comments[index - 1], second: comment})) ||
						(comment.type === 'Block' && String.includes('\n')(String.trim(comment.value)))
				),
				Array.forEach(comment =>
					context.report({
						message: 'A comment is one line that states an outside constraint; rename or split the code instead.',
						node: comment
					})
				)
			)
		}
	}),
	meta: {type: 'suggestion'}
})
