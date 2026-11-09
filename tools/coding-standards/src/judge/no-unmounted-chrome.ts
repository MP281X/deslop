import {question} from '#lib/question.ts'

export const noUnmountedChrome = question(
	'component',
	'Does `code` drop its own bar or navigation while its data loads or fails?',
	{
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
