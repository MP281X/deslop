import {matches} from '#lib/ast.ts'
import {question} from '#lib/question.ts'

// Words an error state shows or is named by.
const ERROR_STATE =
	/error|fail|wrong|oops|crash|broke|problem|retry|unavailable|could ?n[o'’]t|couldn|can[’']?t|cannot|unable|sorry|denied|forbidden|offline|outage|cause|exit|catch|reject|not found|404|5\d\d|lost|unreachable|\bdown\b|issue|invalid|expired|missing|snag|hiccup|trouble|unexpected|went/iu

export const noHeroFailure = question(
	'component',
	'Does `code` render an error state as a hero, with an illustration or image, or a heading larger than body text?',
	{
		gate: unit => unit.jsx && matches(ERROR_STATE)(unit.text),
		message: 'Show a blocking failure compactly: an icon, a short reason and a destructive Retry.',
		no: {
			cases: [
				'A compact error: an icon, a short reason and a Retry, such as an Alert',
				'An empty state, or a signed-out explanation that is not an error',
				'A missing Retry button on its own',
				'A compact failure centred in an otherwise empty screen or pane: centring alone is not a hero'
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
			cases: ['An error branch with an image or illustration, or a heading larger than body text'],
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
