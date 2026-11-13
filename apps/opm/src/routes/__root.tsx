import {useAtomMount, useAtomSubscribe, useAtomValue} from '@effect/atom-react'

import {Array, Function, Option, Schema} from 'effect'

import {Host, NavigationDestination, NavigationStack} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import {Loaded, SessionGate} from '@deslop/components-mobile/screens'
import {colors} from '@deslop/components-mobile/theme'

import {chaptersAtom, diagnosticsAtom, openedAtom, primary, pushAtom, session} from '#lib/chapters.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import {ReaderRoute, ReaderSkeleton} from '#routes/chapters/$number.tsx'
import icon from '#routes/icon.png'
import {keyOf} from '#services/chapters/lib/utils.ts'
import {ChapterKey, ChapterPath} from '#services/chapters/schema.ts'
import type {ChapterNumber, Series} from '#services/chapters/schema.ts'

function Destination(props: {number: ChapterNumber; series: Series}) {
	return (
		<Loaded atom={chaptersAtom}>
			{chapters => <ReaderRoute chapters={chapters} number={props.number} series={props.series} />}
		</Loaded>
	)
}

function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(diagnosticsAtom)
	const opened = useAtomValue(openedAtom)
	const [series, setSeries] = useState<Series>(() =>
		Option.match(opened, {onNone: () => 'manga', onSome: chapter => chapter.series})
	)
	const [path, setPath] = useState(() =>
		Option.match(opened, {onNone: () => Array.empty<ChapterKey>(), onSome: chapter => [keyOf(chapter)]})
	)
	useAtomSubscribe(openedAtom, tapped =>
		Option.match(tapped, {
			onNone: Function.constUndefined,
			onSome: chapter => {
				setSeries(chapter.series)
				setPath([keyOf(chapter)])
			}
		})
	)
	function open(number: ChapterNumber) {
		setPath([keyOf({number, series})])
	}
	return (
		<Host style={{flex: 1}}>
			<NavigationStack
				path={path}
				onPathChange={values => setPath(Array.map(values, value => ChapterKey.make(value)))}
				modifiers={[tint(colors.foreground)]}
			>
				<ChaptersRoute key={series} onOpen={open} series={series} onSeries={setSeries} />
				{Array.map(path, value =>
					Option.match(Schema.decodeUnknownOption(ChapterPath)(value), {
						onNone: Function.constUndefined,
						onSome: target => (
							<NavigationDestination key={value} value={value}>
								<Suspense fallback={<ReaderSkeleton number={target[2]} />}>
									<Destination number={target[2]} series={target[0]} />
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
	return (
		<SessionGate logo={icon} session={session} tint={primary}>
			<AppRoutes />
		</SessionGate>
	)
}
