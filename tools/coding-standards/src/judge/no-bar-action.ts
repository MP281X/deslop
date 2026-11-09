import {question} from '#lib/question.ts'

export const noBarAction = question(
	'component',
	'Does `code` render an action button inside a page header or app bar?',
	{
		message: 'The bar holds only controls that choose what the page shows; move the action into the command palette.',
		no: {
			cases: [
				'Controls that choose what the page shows: tabs, toggle groups, view or range selectors, search fields',
				'Buttons inside a menu, dropdown, popover or command palette',
				'A back or close link',
				'A button outside the header, such as in the page body or floating in a corner',
				'A native toolbar item',
				'What an imported component renders, which `code` does not show'
			],
			example: `
				function Bar() {
					return (
						<header>
							<SearchField />
							<ToggleGroup value={view} onValueChange={setView} />
						</header>
					)
				}
			`
		},
		yes: {
			cases: [
				'A button that runs an action, such as create, delete, refresh or export, inside a header or app bar that `code` renders'
			],
			example: `
				function Bar() {
					return (
						<header>
							<SearchField />
							<Button onClick={createNote}>New note</Button>
						</header>
					)
				}
			`
		}
	}
)
