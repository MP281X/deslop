import {judgedRule} from '#judge/rule.ts'

export const noBarAction = judgedRule({
	criteria: {
		false:
			'Command palette records, context or account menu entries, view selectors, search, back navigation and native SwiftUI toolbar actions are not web bar action buttons. A fixed or floating button outside the header is not in the bar. Do not infer children of imported components.',
		true: 'The rendered web page header or app bar directly contains a standalone action button such as create, delete or refresh, outside a command palette or menu.'
	},
	examples: {
		bad: `function Bar() {
	return (
		<header className="flex h-14 items-center gap-2">
			<AppMark />
			<SearchField />
			<Button onClick={createNote}>New note</Button>
			<Button variant="outline" onClick={refresh}>Refresh</Button>
		</header>
	)
}`,
		good: `function Bar() {
	return (
		<header className="flex h-14 items-center gap-2">
			<AppMark />
			<SearchField />
			<ToggleGroup value={view} onValueChange={setView}>
				<ToggleGroupItem value="servers">Servers</ToggleGroupItem>
				<ToggleGroupItem value="ai">AI</ToggleGroupItem>
			</ToggleGroup>
		</header>
	)
}`
	},
	kind: 'component',
	message:
		'The bar holds only controls that choose what the page shows; move the action into the command palette or the row’s context menu.',
	question: 'Does the component in `code` render a standalone action button directly in a web page header or app bar?'
})
