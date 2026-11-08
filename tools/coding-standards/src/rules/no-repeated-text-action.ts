import {judgedRule} from '#judge/rule.ts'

export const noRepeatedTextAction = judgedRule({
	criteria: {
		false:
			'Menu items, icon-only buttons with accessible labels, mutually exclusive branches, dialog submit/cancel pairs and actions on different items are not repeated text action buttons.',
		true: 'One rendered item has multiple simultaneously visible standalone text action buttons, such as Open, Archive and Delete, rather than one row entrypoint and a context menu.'
	},
	examples: {
		bad: `function NoteRow(props: {note: Note}) {
	return (
		<Item>
			<ItemTitle>{props.note.title}</ItemTitle>
			<Button onClick={() => open(props.note)}>Open</Button>
			<Button onClick={() => archive(props.note)}>Archive</Button>
			<Button onClick={() => remove(props.note)}>Delete</Button>
		</Item>
	)
}`,
		good: `function NoteRow(props: {note: Note}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger render={<Item render={<a href={props.note.url} />} />}>
				<ItemTitle>{props.note.title}</ItemTitle>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={() => archive(props.note)}>Archive</ContextMenuItem>
				<ContextMenuItem variant="destructive" onClick={() => remove(props.note)}>Delete</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}`
	},
	kind: 'component',
	message:
		'Give the thing one entrypoint: the whole row opens it and the rest goes into its context menu, not a row of text buttons.',
	question: 'Does the component in `code` give one item several simultaneously visible standalone text action buttons?'
})
