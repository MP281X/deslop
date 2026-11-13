import {question} from '#lib/question.ts'

export const noCompatibilityCode = question(
	'code',
	'Does `code` keep an old name, path, shape or release working beside the current one: an alias, redirect, conversion, version check or transition window? Require visible evidence of the earlier contract, not a hypothetical older caller.',
	{
		message:
			'Keep only the current contract. Numbered SQL migrations are the sole exception for earlier stored shapes.',
		no: {
			cases: [
				'A numbered SQL migration',
				'An optional value or alternate protocol required by the current contract',
				'A retry or recovery for a reachable current failure',
				'An alias the parser already reports, or source text in a test fixture'
			],
			example: `
				function readSession(row: SessionRow) {
					return Session.make({
						id: row.id,
						incarnation: row.incarnation
					})
				}
			`
		},
		yes: {
			cases: [
				'A default or optional field specifically for records an older release wrote',
				'An old route, RPC, tool, environment key or export retained beside its replacement',
				'A conversion of non-SQL storage or an old-shape branch outside a numbered migration'
			],
			example: `
				function readSession(row: SessionRow) {
					return Session.make({
						id: row.id,
						// Sessions written before incarnations were introduced still load.
						incarnation: row.incarnation ?? 'legacy'
					})
				}
			`
		}
	}
)
