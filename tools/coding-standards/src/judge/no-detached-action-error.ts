import {question} from '#lib/question.ts'

export const noDetachedActionError = question(
	'component',
	'Does `code` handle an action failure only in a toast, log or page banner instead of on the control that started it?',
	{
		message: 'Show a failed action on the control that started it, and whether it committed.',
		no: {
			cases: [
				'A failure shown on or beside the control that started the action, such as its variant, tooltip or inline text',
				'Calling an imported action or atom setter with no failure handling in `code`',
				'Navigation, links, closing a dialog and synchronous state updates'
			],
			example: `
				function DeleteNote(props: {id: string}) {
					const [result, remove] = useAtom(removeNote)
					return (
						<Button variant={Result.isFailure(result) ? 'destructive' : 'ghost'} onClick={() => remove(props.id)}>
							Delete
						</Button>
					)
				}
			`
		},
		yes: {
			cases: [
				'A failure handler of a mutation in `code` that only logs or discards the error, or shows it in a toast or page-level banner'
			],
			example: `
				function DeleteNote(props: {id: string}) {
					const remove = useAtomSet(removeNote, {mode: 'promise'})
					return <Button onClick={() => remove(props.id).catch(error => toast.error(String(error)))}>Delete</Button>
				}
			`
		}
	}
)
