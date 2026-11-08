import {judgedRule} from '#judge/rule.ts'

export const noHeroFailure = judgedRule({
	criteria: {
		false:
			'A normal-size failure reason, compact Alert, empty state or expired sign-in explanation is not a hero. Missing Retry or using Empty alone does not prove oversized presentation.',
		true: 'A failure branch visibly uses a large decorative illustration, oversized heading or spacious promotional hero layout for the error.'
	},
	examples: {
		bad: `function LoadFailed(props: {retry: () => void}) {
	return (
		<div className="flex flex-col items-center gap-6 py-24">
			<img src={brokenRobot} className="size-48" />
			<h1 className="text-3xl font-bold">Oops! Something went wrong</h1>
			<p>We could not load your notes. Please try again later.</p>
			<Button size="lg" onClick={props.retry}>Try again</Button>
		</div>
	)
}`,
		good: `function LoadFailed(props: {retry: () => void}) {
	return (
		<Alert variant="destructive">
			<WarningIcon />
			<AlertTitle>Notes did not load</AlertTitle>
			<Button variant="destructive" size="sm" onClick={props.retry}>Retry</Button>
		</Alert>
	)
}`
	},
	kind: 'component',
	message:
		'Show a blocking failure compactly: an icon, a short reason and a destructive Retry, never a hero, illustration or second heading.',
	question: 'Does the component in `code` visibly present a failure as an oversized decorative hero?'
})
