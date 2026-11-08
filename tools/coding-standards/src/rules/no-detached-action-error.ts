import {judgedRule} from '#judge/rule.ts'

export const noDetachedActionError = judgedRule({
	criteria: {
		false:
			'An imported action or atom setter alone does not reveal failure handling. Links, navigation, dialog closure, synchronous state updates and absence of local error JSX are not evidence.',
		true: 'A mutation failure branch is visible and explicitly discards the error, logs it only, or sends it solely to a global toast or unrelated page banner, without marking its initiating control.'
	},
	examples: {
		bad: `function DeleteNote(props: {id: string}) {
	const remove = useAtomSet(removeNote, {mode: 'promise'})
	return (
		<Button
			variant="ghost"
			onClick={() => remove(props.id).catch(error => toast.error(String(error)))}
		>
			<TrashIcon />
		</Button>
	)
}`,
		good: `function DeleteNote(props: {id: string}) {
	const [result, remove] = useAtom(removeNote)
	return (
		<Tooltip content={Result.isFailure(result) ? 'Could not delete; retry' : 'Delete'}>
			<Button variant={Result.isFailure(result) ? 'destructive' : 'ghost'} onClick={() => remove(props.id)}>
				<TrashIcon />
			</Button>
		</Tooltip>
	)
}`
	},
	kind: 'component',
	message:
		'Show a failed action on the control that started it, so the person sees what failed and whether it committed.',
	question:
		'Does a visible mutation failure handler in the component in `code` detach the error from the initiating control?'
})
