import {judgedRule} from '#judge/rule.ts'

export const noControlForWrongJob = judgedRule({
	criteria: {
		false:
			"Tabs selecting content, buttons opening links or dialogs, menu triggers, and badges that only label are correct. An onClick handler alone does not establish the control's semantic job.",
		true: 'The visible interaction uses tabs to execute a mutation such as export or delete, or uses a badge as an action control instead of a button.'
	},
	examples: {
		bad: `function Toolbar() {
	return (
		<Tabs value="none">
			<TabsList>
				<TabsTrigger value="export" onClick={exportAll}>Export</TabsTrigger>
				<TabsTrigger value="clear" onClick={clearAll}>Clear</TabsTrigger>
			</TabsList>
		</Tabs>
	)
}`,
		good: `function Toolbar() {
	return (
		<Tabs value={view} onValueChange={setView}>
			<TabsList>
				<TabsTrigger value="list">List</TabsTrigger>
				<TabsTrigger value="map">Map</TabsTrigger>
			</TabsList>
		</Tabs>
	)
}`
	},
	kind: 'component',
	message:
		'Use each control for its job: tabs switch views, a button runs an action or opens something, a badge only labels.',
	question:
		'Does the component in `code` visibly use a labeling or view-selection primitive to perform an action rather than its semantic job?'
})
