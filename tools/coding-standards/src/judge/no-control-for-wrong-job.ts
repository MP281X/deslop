import {question} from '#lib/question.ts'

export const noControlForWrongJob = question(
	'component',
	'Does `code` use a tab to run an action instead of to switch the view?',
	{
		message: 'Tabs switch views; run an action from a button.',
		no: {
			cases: [
				'Tabs that select which view or content is shown',
				'Buttons that run actions or open links, dialogs or menus',
				'An onClick on a tab that only records which tab is selected'
			],
			example: `
				function Toolbar() {
					return (
						<TabsList>
							<TabsTrigger value="list">List</TabsTrigger>
							<TabsTrigger value="map">Map</TabsTrigger>
						</TabsList>
					)
				}
			`
		},
		yes: {
			cases: ['A tab trigger whose click runs an action, such as export, delete or clear'],
			example: `
				function Toolbar() {
					return (
						<TabsList>
							<TabsTrigger value="export" onClick={exportAll}>Export</TabsTrigger>
						</TabsList>
					)
				}
			`
		}
	}
)
