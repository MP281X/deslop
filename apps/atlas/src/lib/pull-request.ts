import {Array, Boolean} from 'effect'

import type {PullRequest} from '#services/changes/schema.ts'

// A pull request is the same record when its repository and number are, whatever snapshot it came from.
export function isSamePullRequest(pr: PullRequest, selected?: PullRequest) {
	if (selected === undefined) return false
	return selected.repoId === pr.repoId && selected.number === pr.number
}

// The problems a reader must act on, as one phrase for the dot and the label; passing checks and an approval are not problems.
export function problemOf(pr: PullRequest) {
	return Array.match(
		[
			...Boolean.match(pr.checks === 'failing', {onFalse: () => [], onTrue: () => ['Checks failing']}),
			...Boolean.match(pr.review === 'changes', {onFalse: () => [], onTrue: () => ['changes requested']})
		],
		{onEmpty: () => undefined, onNonEmpty: problems => Array.join(problems, '; ')}
	)
}
