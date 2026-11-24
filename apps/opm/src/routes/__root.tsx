import {useAtomMount, useAtomSubscribe, useAtomValue} from '@effect/atom-react'

import {Function, Option} from 'effect'

import {Host} from '@expo/ui/swift-ui'
import {tint} from '@expo/ui/swift-ui/modifiers'
import {Suspense, useState} from 'react'

import {ListDetail} from '@deslop/components-mobile/blocks/list-detail'
import {Loaded} from '@deslop/components-mobile/blocks/loaded'
import {SessionGate} from '@deslop/components-mobile/blocks/session-gate'
import {colors} from '@deslop/components-mobile/theme'

import {chaptersAtom, diagnosticsAtom, openedAtom, pushAtom, unsavedAtom} from '#lib/chapters.ts'
import {withUnsaved} from '#lib/reader.ts'
import {session} from '#lib/session.ts'
import {ChaptersRoute} from '#routes/(home)/index.tsx'
import {ReaderRoute, ReaderSkeleton} from '#routes/chapters/$number.tsx'
import {keyOf} from '#services/chapters/lib/utils.ts'
import type {ChapterIdentity, ChapterNumber, Series} from '#services/chapters/schema.ts'

function Reader(props: ChapterIdentity) {
	const unsaved = useAtomValue(unsavedAtom)
	return (
		<Loaded atom={chaptersAtom}>
			{chapters => (
				<ReaderRoute chapters={withUnsaved(chapters, unsaved)} number={props.number} series={props.series} />
			)}
		</Loaded>
	)
}

function AppRoutes() {
	useAtomMount(pushAtom)
	useAtomMount(diagnosticsAtom)
	const tapped = useAtomValue(openedAtom)
	const [opened, setOpened] = useState(tapped)
	const [series, setSeries] = useState<Series>(() =>
		Option.match(tapped, {onNone: Function.constant('manga'), onSome: chapter => chapter.series})
	)
	useAtomSubscribe(openedAtom, next =>
		Option.match(next, {
			onNone: Function.constUndefined,
			onSome: chapter => {
				setSeries(chapter.series)
				setOpened(Option.some(chapter))
			}
		})
	)
	function open(number: ChapterNumber) {
		setOpened(Option.some({number, series}))
	}
	// A chapter opens alone, so unfolded its pages spread across both halves.
	return (
		<Host style={{flex: 1}}>
			<ListDetail
				alone
				opened={Option.isSome(opened)}
				onClose={() => setOpened(Option.none())}
				modifiers={[tint(colors.foreground)]}
				list={<ChaptersRoute key={series} onOpen={open} series={series} onSeries={setSeries} />}
				detail={Option.match(opened, {
					onNone: Function.constUndefined,
					onSome: chapter => (
						<Suspense key={keyOf(chapter)} fallback={<ReaderSkeleton number={chapter.number} />}>
							<Reader number={chapter.number} series={chapter.series} />
						</Suspense>
					)
				})}
			/>
		</Host>
	)
}

export function RootRoute() {
	return (
		<SessionGate session={session}>
			<AppRoutes />
		</SessionGate>
	)
}
