import {judgedRule} from '#judge/rule.ts'

export const noInternalsTest = judgedRule({
	criteria: {
		false:
			'Inputs captured at an injected service or network boundary, persisted outputs, notifications, resource acquisition/release and deduplication counts can be owned observable behavior. Asserting an outgoing request or service input is not private structure. Fakes and counters alone are not evidence.',
		true: "An assertion reads a private field or internal cache, or requires an incidental internal mock call or storage layout rather than the service's observable output or externally required side effect."
	},
	examples: {
		bad: `it('saves a note', async () => {
	const service = new NotesService(store)
	await service.save({title: 'a'})
	expect(service['cache'].size).toBe(1)
	expect(store.set).toHaveBeenCalledWith('notes/a', expect.anything())
})`,
		good: `it.effect('a saved note is found by its title', () =>
	Effect.gen(function* () {
		const notes = yield* Notes
		yield* notes.save({title: 'a'})
		assert.deepEqual(Array.map(yield* notes.search('a'), note => note.title), ['a'])
	})
)`
	},
	kind: 'test',
	message:
		'Assert what a caller observes; a test of private fields or mock calls breaks with every refactor and survives real bugs.',
	question: 'Does the test in `code` assert private implementation structure rather than an owned observable behavior?'
})
