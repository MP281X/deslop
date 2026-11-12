import {matches} from '#lib/ast.ts'
import {question} from '#lib/question.ts'

// Words an error state shows or is named by.
const ERROR_STATE =
	/error|fail|wrong|oops|crash|broke|problem|retry|unavailable|could ?n[o'’]t|couldn|can[’']?t|cannot|unable|sorry|denied|forbidden|offline|outage|cause|exit|catch|reject|not found|404|5\d\d|lost|unreachable|\bdown\b|issue|invalid|expired|missing|snag|hiccup|trouble|unexpected|went/iu

export const noHeroFailure = question(
	'component',
	'Does `code` render an error state as a hero, with an illustration, an oversized heading or a large centred layout?',
	{
		gate: unit => unit.jsx && matches(ERROR_STATE)(unit.text),
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
