import {matches} from '#lib/ast.ts'
import {question} from '#lib/question.ts'

// Words naming a bar, navigation or other chrome.
const CHROME =
	/bar|header|nav|tab|title|search|menu|breadcrumb|segment|picker|toolbar|sidebar|heading|<h[1-6]|screen|switch|layout|shell|chrome|stack/iu
// Words of a loading or failed branch.
const LOADING =
	/match|builder|suspense|fallback|onInitial|onFailure|onWaiting|onSuccess|isInitial|isFailure|isSuccess|isWaiting|waiting|loading|pending|error|fail/iu

export const noUnmountedChrome = question(
	'component',
	'Does `code` drop its own bar or navigation while its data loads or fails?',
	{
		// Chrome, and a branch that can render without it.
		gate: unit => matches(CHROME)(unit.text) && (unit.returns >= 2 || unit.branches || matches(LOADING)(unit.text)),
		message:
			'Keep the bar, navigation and pane geometry mounted while loading or failed; only the content region loads.',
		no: {
			cases: [
				'Loading inside the content region while the bar and navigation stay rendered, such as a Suspense or skeleton around the content',
				'A component that never renders a bar or navigation itself',
				'A blank screen while the session is checked, or a sign-in gate',
				'What an imported loading component renders, which `code` does not show'
			],
			example: `
				function Page() {
					return (
						<>
							<Bar />
							<Suspense fallback={<ListSkeleton />}>
								<Content />
							</Suspense>
						</>
					)
				}
			`
		},
		yes: {
			cases: [
				'An early return of only a spinner, skeleton or error, while the success branch of `code` renders a bar, header, tabs or navigation'
			],
			example: `
				function Page() {
					const data = useAtomValue(pageAtom)
					if (Result.isInitial(data)) return <Spinner />
					return (
						<>
							<Bar />
							<Content data={data} />
						</>
					)
				}
			`
		}
	}
)
