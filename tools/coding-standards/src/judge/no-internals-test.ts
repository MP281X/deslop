import {question} from '#lib/question.ts'

export const noInternalsTest = question(
	'test',
	'Does the test in `code` assert on private state or incidental internal calls instead of what a caller observes?',
	{
		message:
			'Assert what a caller observes; a test of private state breaks with every refactor and survives real bugs.',
		no: {
			cases: [
				'Assertions on returned values, persisted outputs, notifications or errors',
				'Assertions on the request or input sent across a service or network boundary',
				'Counts of resource acquisition and release, or of deduplicated calls',
				'Fakes and counters that only drive the scenario'
			],
			example: `
				it('finds a saved note by its title', async () => {
					const notes = new Notes(store)
					await notes.save({title: 'a'})
					expect(await notes.search('a')).toEqual([{title: 'a'}])
				})
			`
		},
		yes: {
			cases: [
				'An assertion that reads a private field or internal cache',
				'An assertion that an internal helper or mock was called, or on how storage is laid out, when no caller requires it'
			],
			example: `
				it('saves a note', async () => {
					const notes = new Notes(store)
					await notes.save({title: 'a'})
					expect(notes['cache'].size).toBe(1)
				})
			`
		}
	}
)
