import {question} from '#lib/question.ts'

export const noUninvalidatedWrite = question(
	'code',
	'Does a visible write change rows a client watches without invalidating that table through Reactivity.mutation inside its transaction? A finding needs a visible watched key and a write path; do not invent watchers or hide an imported helper’s unknown behavior.',
	{
		message: 'Invalidate the watched table key inside the write transaction, so subscribers reread committed rows.',
		no: {
			cases: [
				'A write to rows no client watches',
				'A write and its matching invalidation in one transaction',
				'An imported writer whose transaction and watched keys are not shown',
				'A numbered SQL migration before subscriptions exist'
			],
			example: `
				function notes() {
					return {
						rename: (id: string, title: string) => sql.withTransaction(
							Reactivity.mutation(sql\`UPDATE notes SET title = \${title} WHERE id = \${id}\`, ['notes'])
						),
						watch: sql.reactive(['notes'], sql\`SELECT * FROM notes\`)
					}
				}
			`
		},
		yes: {
			cases: [
				'A write alongside a visible table watch with no matching invalidation',
				'An invalidation before commit, letting subscribers cache the previous rows',
				'A write that invalidates a different visible table key'
			],
			example: `
				function notes() {
					return {
						rename: (id: string, title: string) => sql\`UPDATE notes SET title = \${title} WHERE id = \${id}\`,
						watch: sql.reactive(['notes'], sql\`SELECT * FROM notes\`)
					}
				}
			`
		}
	}
)
