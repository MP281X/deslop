import {question} from '#lib/question.ts'

export const noRepeatedTextAction = question(
	'component',
	'Does `code` render a list row with two or more text buttons for different actions on its item?',
	{
		message: 'The whole row opens the item; move its other actions into the row’s context menu.',
		no: {
			cases: [
				'Actions inside a context menu, dropdown or menu',
				'Icon-only buttons',
				'A decision pair on a card or dialog, such as Approve and Deny, or Save and Cancel',
				'Alternative ways to do one thing, such as signing in with GitHub or with a passkey',
				'Buttons in a native form section',
				'Buttons that act on different items',
				'Buttons in branches that never render together'
			],
			example: `
				function NoteRow(props: {note: Note}) {
					return (
						<ContextMenu>
							<ContextMenuTrigger render={<Item />}>{props.note.title}</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onClick={() => archive(props.note)}>Archive</ContextMenuItem>
								<ContextMenuItem onClick={() => remove(props.note)}>Delete</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					)
				}
			`
		},
		yes: {
			cases: [
				'Two or more buttons with text labels, such as Open, Archive and Delete, rendered together on one row of a list'
			],
			example: `
				function NoteRow(props: {note: Note}) {
					return (
						<Item>
							<ItemTitle>{props.note.title}</ItemTitle>
							<Button onClick={() => archive(props.note)}>Archive</Button>
							<Button onClick={() => remove(props.note)}>Delete</Button>
						</Item>
					)
				}
			`
		}
	}
)
