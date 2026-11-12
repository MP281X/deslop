import {question} from '#lib/question.ts'

export const noSelfFetchingComponent = question(
	'component',
	'Does `code` fetch, poll or subscribe to remote data itself and keep the result in component state?',
	{
		// Component state, a ref, an effect or an atom setter holds what the component fetched.
		gate: unit => unit.stateHooks,
		message:
			'Read the value from the atom that keeps it in sync; fetching, polling and streaming belong to its service.',
		no: {
			cases: [
				'Reading an atom or query hook',
				'Calling a mutation from an event handler',
				'Subscribing to local UI events, such as resize or keyboard',
				'What an imported hook does, which `code` does not show',
				'A global fetch, a timer such as setInterval or a promise’s then: lint reports these'
			],
			example: `
				function Notes() {
					const notes = useAtomValue(notesAtom)
					return <NoteList notes={notes} />
				}
			`
		},
		yes: {
			cases: [
				'A client call, polling schedule or remote subscription started in the component body or an effect, with its result stored in state or a ref'
			],
			example: `
				function Notes() {
					const [notes, setNotes] = useState<Note[]>([])
					useEffect(() => client.subscribe('notes', setNotes), [])
					return <NoteList notes={notes} />
				}
			`
		}
	}
)
