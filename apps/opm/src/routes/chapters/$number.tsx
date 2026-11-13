import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Number, Option, pipe} from 'effect'

import {Toolbar} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	frame,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding
} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import {space} from '@deslop/components-mobile/theme'
import {Empty} from '@deslop/components-mobile/ui/empty'
import {Skeleton} from '@deslop/components-mobile/ui/skeleton'

import {readerAtom, unreachableAtom} from '#lib/chapters.ts'
import {PageStrip} from '#modules/native/index.ts'
import {byNumber, keyOf} from '#services/chapters/lib/utils.ts'
import type {ChapterList, ChapterNumber, Series} from '#services/chapters/schema.ts'

// The reader's content skeleton; the full-page fallback adds the chapter title.
function ReaderLoading(props: {modifiers?: ViewModifier[]}) {
	return (
		<Skeleton
			modifiers={[
				frame({maxHeight: Infinity, maxWidth: Infinity}),
				padding({all: space[4]}),
				accessibilityLabel('Loading chapter'),
				...(props.modifiers ?? [])
			]}
		/>
	)
}

// The reader's full-page skeleton, also used while the chapter list itself loads behind a notification.
export function ReaderSkeleton(props: {number: ChapterNumber}) {
	return (
		<ReaderLoading modifiers={[navigationTitle(`Chapter ${props.number}`), navigationBarTitleDisplayMode('inline')]} />
	)
}

export function ReaderRoute(props: {chapters: ChapterList; number: ChapterNumber; series: Series; start?: number}) {
	const reader = keyOf(props)
	const following = pipe(
		props.chapters,
		Array.sort(byNumber),
		Array.filter(chapter => chapter.series === props.series && chapter.number >= props.number)
	)
	const [state, turn] = useAtom(readerAtom(reader))
	const visible = Array.take(following, state.shown)
	const gaveUp = AsyncResult.isSuccess(useAtomValue(unreachableAtom(reader)))

	// A notification can open a chapter the copy on the iPhone does not have yet; the server's list brings it, unless it is out of reach.
	return (
		<Toolbar
			modifiers={[
				navigationTitle(`Chapter ${Option.getOrElse(state.inView, () => props.number)}`),
				navigationBarTitleDisplayMode('inline')
			]}
		>
			{Array.match(visible, {
				onEmpty: () =>
					Boolean.match(gaveUp, {
						onFalse: () => <ReaderLoading />,
						onTrue: () => <Empty systemImage="book.closed" label="Chapter Unavailable" />
					}),
				onNonEmpty: shown => (
					<PageStrip
						pages={Array.flatMap(shown, chapter => chapter.pages)}
						start={Number.clamp(
							props.start ??
								pipe(
									Array.headNonEmpty(shown).reading,
									Option.filter(reading => !reading.done),
									Option.match({onNone: () => 0, onSome: reading => reading.page})
								),
							{maximum: Number.max(Array.headNonEmpty(shown).pages.length - 1, 0), minimum: 0}
						)}
						onPage={event => turn({following, index: event.nativeEvent.index, opened: props.number})}
					/>
				)
			})}
		</Toolbar>
	)
}
