import {question} from '#lib/question.ts'

export const noRepeatedTextAction = question(
	'component',
	'Does `code` render a list row with two or more text buttons for different actions on its item?',
	{
		// Two actions render two pressables, or one inside a row rendered per item.
		gate: unit => unit.pressables >= 2 || unit.nestedPressables >= 1,
		message:
			'The row opens the item; other allowed actions use trailing icons or a menu. Web has no removal control or context menu; native removal uses its long-press menu or swipe.',
		no: {
			cases: [
				'Actions inside a trailing dropdown or menu',
				'A trailing icon-only button for an allowed action, such as pinning',
				'Native removal in a long-press menu or swipe, not a web removal affordance',
				'A decision pair on a card or dialog, such as Approve and Deny, or Save and Cancel',
				'Alternative ways to do one thing, such as signing in with GitHub or with a passkey',
				'Buttons in a native form section',
				'Buttons that act on different items',
				'Buttons in branches that never render together'
			],
			example: `
				function NoteRow(props: {note: Note}) {
					return (
						<Item>
							<ItemTitle>{props.note.title}</ItemTitle>
							<Button variant="ghost" size="icon-sm" aria-label="Pin" onClick={() => pin(props.note)}>
								<PushPinIcon />
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
									<DotsThreeIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => archive(props.note)}>Archive</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</Item>
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
