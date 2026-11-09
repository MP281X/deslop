import {useAtomMount, useAtomRefresh, useAtomSubscribe, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Option, Result, Schema} from 'effect'

import {Host, NavigationDestination, NavigationStack} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import {BlankScreen, FailureContent, SessionGate, shownOf} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {updateAtom} from '@deslop/runtime/mobile'

import {chaptersAtom, diagnosticsAtom, openedAtom, primary, pushAtom, session} from '#lib/utils.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import {ReaderRoute} from '#routes/chapters/$number.tsx'
import icon from '#routes/icon.png'
import {keyOf} from '#services/chapters/lib/utils.ts'
import {ChapterPath} from '#services/chapters/schema.ts'
import type {Series} from '#services/chapters/schema.ts'

// A pushed chapter reads its data inside native navigation.
function Destination(props: {number: number; series: Series; start?: number}) {
	const loaded = useAtomSuspense(chaptersAtom, {includeFailure: true})
	const refresh = useAtomRefresh(chaptersAtom)
	const shown = shownOf(loaded)
	if (Result.isFailure(shown)) {
		return <FailureContent cause={shown.failure} name="Chapters" onRetry={refresh} />
	}
	return <ReaderRoute chapters={shown.success} number={props.number} series={props.series} start={props.start} />
}

// The app opens on the list; a tapped notification opens its chapter.
function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(diagnosticsAtom)
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
	return (
		<Host style={{flex: 1}}>
			<NavigationStack path={path} onPathChange={setPath} modifiers={[tint(colors.foreground)]}>
				<ChaptersRoute key={series} onOpen={open} series={series} onSeries={setSeries} />
				{Array.map(path, value =>
					Option.match(Schema.decodeUnknownOption(ChapterPath)(value), {
						onNone: () => undefined,
						onSome: target => (
							<NavigationDestination key={value} value={value}>
								<Suspense fallback={<ItemGroupSkeleton rows={10} />}>
									<Destination number={target[2]} series={target[0]} start={resumePage} />
								</Suspense>
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
				<AppRoutes />
			</SessionGate>
		</Suspense>
	)
}
