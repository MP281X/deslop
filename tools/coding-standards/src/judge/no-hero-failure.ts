import {question} from '#lib/question.ts'

export const noHeroFailure = question(
	'component',
	'Does `code` render an error state as a hero, with an illustration, an oversized heading or a large centred layout?',
	{
		message: 'Show a blocking failure compactly: an icon, a short reason and a destructive Retry.',
		no: {
			cases: [
				'A compact error: an icon, a short reason and a Retry, such as an Alert',
				'An empty state, or a signed-out explanation that is not an error',
				'A missing Retry button on its own'
			],
			example: `
				function LoadFailed(props: {retry: () => void}) {
					return (
						<Alert variant="destructive">
							<AlertTitle>Notes did not load</AlertTitle>
							<Button onClick={props.retry}>Retry</Button>
						</Alert>
					)
				}
			`
		},
		yes: {
			cases: [
				'An error branch with a large image or illustration, a heading larger than body text, or a padded centred hero layout'
			],
			example: `
				function LoadFailed() {
					return (
						<div className="flex flex-col items-center py-24">
							<img src={brokenRobot} className="size-48" />
							<h1 className="text-3xl">Oops! Something went wrong</h1>
						</div>
					)
				}
			`
		}
	}
)
