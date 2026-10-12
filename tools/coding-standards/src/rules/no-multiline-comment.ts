import {Array, String, pipe} from 'effect'

import {defineRule} from '@oxlint/plugins'
import type {ESTree} from '@oxlint/plugins'

const directive = /^\s*(?:eslint|oxlint|@effect-diagnostics|@ts-|\/\s*<reference|#region|#endregion)/u

function adjacentLines(pair: {first?: ESTree.Comment; second?: ESTree.Comment}) {
	const first = pair.first
	const second = pair.second
	return first?.type === 'Line' && second?.type === 'Line' && second.loc.start.line === first.loc.end.line + 1
}

export const noMultilineComment = defineRule({
	create: context => ({
		Program: () => {
			const comments = pipe(
				context.sourceCode.getAllComments(),
				Array.filter(comment => !directive.test(comment.value))
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
