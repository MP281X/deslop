import {judgedRule} from '#judge/rule.ts'

export const noSelfFetchingComponent = judgedRule({
	criteria: {
		false:
			'Reading an atom or query hook, sending a mutation from an event handler, or subscribing to local UI events is not fetching. Do not infer what an imported hook does.',
		true: 'The component itself starts a remote read, polling timer or remote subscription in its body or effect and manually stores the returned data.'
	},
	examples: {
		bad: `function Notes() {
	const [notes, setNotes] = useState<Note[]>([])
	useEffect(() => {
		const id = setInterval(() => client.list().then(setNotes), 5000)
		return () => clearInterval(id)
	}, [])
	return <NoteList notes={notes} />
}`,
		good: `function Notes() {
	const notes = useAtomValue(notesAtom)
	return Result.builder(notes)
		.onSuccess(found => <NoteList notes={found} />)
		.render()
}`
	},
	kind: 'component',
	message:
		'Read the value from the atom that keeps it in sync; fetching, polling and streaming belong to the service and its atom.',
	question:
		'Does the React component in `code` itself manage fetching remote data instead of reading synchronized state?'
})
