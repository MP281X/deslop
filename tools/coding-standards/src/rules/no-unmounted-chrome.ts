import {judgedRule} from '#judge/rule.ts'

export const noUnmountedChrome = judgedRule({
	criteria: {
		false:
			'Content-only readers, local Suspense, geometry-matched pane skeletons, blank session gates and auth-denial boundaries do not show ordinary page chrome being removed. Do not assume what imported loading components render.',
		true: 'The same component visibly renders page bars or navigation in its success branch but returns only a spinner or placeholder instead of that chrome during an ordinary data load or outage.'
	},
	examples: {
		bad: `function Page() {
	const data = useAtomValue(pageAtom)
	if (Result.isInitial(data)) return <Spinner className="m-auto" />
	return (
		<>
			<Bar />
			<Tabs />
			<Content data={data} />
		</>
	)
}`,
		good: `function Page() {
	return (
		<>
			<Bar />
			<Tabs />
			<Suspense fallback={<ItemListSkeleton rows={8} />}>
				<Content />
			</Suspense>
		</>
	)
}`
	},
	kind: 'component',
	message:
		'Keep the bar, navigation and pane geometry mounted through loading and errors; only the content region loads.',
	question:
		'Does the component in `code` visibly remove its own page bars or navigation during an ordinary data load or outage?'
})
