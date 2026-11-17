import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Number, Option, pipe} from 'effect'

import {Image, Toolbar} from '@expo/ui/swift-ui'
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
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {Skeleton} from '@deslop/components-mobile/ui/skeleton'

import {readerAtom, unreachableAtom} from '#lib/chapters.ts'
import {PageStrip} from '#modules/native/index.ts'
import {byNumber, keyOf} from '#services/chapters/lib/utils.ts'
import type {ChapterNumber, Series} from '#services/chapters/schema.ts'
import type {ChapterList} from '#services/reading/schema.ts'

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

export function ReaderRoute(props: {chapters: ChapterList; number: ChapterNumber; series: Series}) {
	const reader = keyOf(props)
	const following = pipe(
		props.chapters,
		Array.findFirst(chapter => chapter.series === props.series && chapter.number === props.number),
		Option.match({
			onNone: () => Array.empty<ChapterList[number]>(),
			onSome: opened =>
				pipe(
					props.chapters,
					Array.filter(chapter => chapter.series === opened.series && chapter.number >= opened.number),
					Array.sort(byNumber)
				)
		})
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
						onTrue: () => (
							<Empty>
								<EmptyMedia>
									<Image systemName="book.closed" modifiers={[accessibilityLabel('Chapter Unavailable')]} />
								</EmptyMedia>
							</Empty>
						)
					}),
				onNonEmpty: shown => (
					<PageStrip
						pages={Array.flatMap(shown, chapter => chapter.pages)}
						start={Number.clamp(
							pipe(
								Array.headNonEmpty(shown).reading,
								Option.filter(reading => !reading.done),
								Option.match({onNone: Function.constant(0), onSome: reading => reading.page})
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
