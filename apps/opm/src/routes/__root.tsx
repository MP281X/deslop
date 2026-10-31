import {useAtomMount, useAtomRefresh, useAtomSubscribe, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, Schema} from 'effect'

import {Host, NavigationDestination, NavigationStack} from '@expo/ui/swift-ui'
import {background, tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {BlankScreen, FailureScreen, LoadingScreen, SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'
import {updateAtom} from '@deslop/runtime/mobile'

import {chaptersAtom, diagnosticsAtom, openedAtom, primary, pushAtom, session} from '#lib/utils.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import icon from '#routes/app.icon/Assets/icon.png'
import {ReaderRoute} from '#routes/chapters/$number.tsx'
import {keyOf} from '#services/chapters/lib/utils.ts'
import {ChapterPath} from '#services/chapters/schema.ts'
import type {Series} from '#services/chapters/schema.ts'

// The app opens on the list; a tapped notification opens its chapter.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(diagnosticsAtom)
	const loaded = useAtomSuspense(chaptersAtom, {includeFailure: true})
	const refreshChapters = useAtomRefresh(chaptersAtom)
	const opened = useAtomValue(openedAtom)
	const [series, setSeries] = useState<Series>(() =>
		Option.match(opened, {onNone: () => 'manga', onSome: chapter => chapter.series})
	)
	const [resumePage, setResumePage] = useState<number>()
	const [path, setPath] = useState(() =>
		Option.match(opened, {onNone: () => Array.empty<string>(), onSome: chapter => [keyOf(chapter)]})
	)
	useAtomSubscribe(openedAtom, tapped =>
		Option.match(tapped, {
			onNone: () => undefined,
			onSome: chapter => {
				setResumePage(undefined)
				setSeries(chapter.series)
				setPath([keyOf(chapter)])
			}
		})
	)
	function open(number: number, page?: number) {
		setResumePage(page)
		setPath([keyOf({number, series})])
	}
	if (AsyncResult.isFailure(loaded)) {
		return <FailureScreen cause={loaded.cause} name="opm" onRetry={refreshChapters} tint={primary} />
	}
	const chapters = loaded.value

	return (
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={setPath}
				modifiers={[tint(colors.foreground), background(colors.background)]}
			>
				<ChaptersRoute
					key={series}
					chapters={Array.filter(chapters, chapter => chapter.series === series)}
					onOpen={open}
					series={series}
					onSeries={setSeries}
				/>
				{Array.map(path, value =>
					Option.match(Schema.decodeUnknownOption(ChapterPath)(value), {
						onNone: () => undefined,
						onSome: target => (
							<NavigationDestination key={value} value={value}>
								<ReaderRoute key={value} chapters={chapters} number={target[2]} series={target[0]} start={resumePage} />
							</NavigationDestination>
						)
					})
				)}
			</NavigationStack>
		</Host>
	)
}

export function RootRoute() {
	useAtomMount(updateAtom)
	return (
		<Suspense fallback={<BlankScreen />}>
			<SessionGate logo={icon} session={session.machine} tint={primary}>
				<Suspense fallback={<LoadingScreen />}>
					<AppRoutes />
				</Suspense>
			</SessionGate>
		</Suspense>
	)
}
