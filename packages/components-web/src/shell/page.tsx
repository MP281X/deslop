import type {ReactNode} from 'react'

// A column page centres one 40rem stack of cards; a workspace takes the viewport. Editorial documents own their separate paper layout.
export function Page(props: {children: ReactNode}) {
	return (
		// Positioned, so a row's screen-reader text stays beside it in this scroller.
		<main className="pb-safe-bottom relative flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
			<div className="flex min-h-full w-full max-w-160 flex-col gap-4 self-start">{props.children}</div>
		</main>
	)
}
