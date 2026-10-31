import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, HashSet, Number, Option, pipe} from 'effect'

import {ProgressView, Toolbar} from '@expo/ui/swift-ui'
import {background, frame, navigationBarTitleDisplayMode, navigationTitle} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useRef, useState} from 'react'

import {colors} from '@deslop/components-mobile/theme'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-mobile/ui/empty'

import {readAtom, unreachableAtom} from '#lib/utils.ts'
import {PageStrip} from '#modules/native/index.ts'
import {byNumber} from '#services/chapters/lib/utils.ts'
import type {ChapterList, Series} from '#services/chapters/schema.ts'

// Immutable, so every reader starts from this one value and replaces it as chapters finish.
const NOTHING_FINISHED = HashSet.empty<number>()

// The strip grows into the next chapter as it is reached; no separate reading mode or navigation button.
export function ReaderRoute(props: {chapters: ChapterList; number: number; series: Series; start?: number}) {
	const read = useAtomSet(readAtom)
	const following = pipe(
		Array.sort(props.chapters, byNumber),
		Array.filter(chapter => chapter.series === props.series && chapter.number >= props.number)
	)
	// The continuous strip grows one chapter at a time as the reader reaches the last one in it.
	const [length, setLength] = useState(2)
	const [scrolledTo, setScrolledTo] = useState(Option.none<number>)
	const previous = useRef(props.number)
	// What this reader finished, so a page turn before the server's copy of the list arrives cannot unfinish it.
	const finished = useRef(NOTHING_FINISHED)
	const shown = Array.take(following, length)
	// Where each chapter's first page sits in the strip.
	const starts = Array.scan(shown, 0, (total, chapter) => total + chapter.pages.length)
	const gaveUp = AsyncResult.isSuccess(useAtomValue(unreachableAtom(`${props.series}:${props.number}`)))

	// A notification can open a chapter the copy on the iPhone does not have yet; the server's list brings it, unless it is out of reach.
	if (!Array.isReadonlyArrayNonEmpty(shown)) {
		if (gaveUp) {
			return (
				<Empty modifiers={[navigationTitle(''), background(colors.background)]}>
					<EmptyHeader>
						<EmptyMedia systemImage="book.closed" />
						<EmptyTitle>Chapter Unavailable</EmptyTitle>
					</EmptyHeader>
				</Empty>
			)
		}
		return (
			<ProgressView
				modifiers={[
					navigationTitle(''),
					frame({maxHeight: Infinity, maxWidth: Infinity}),
					background(colors.background)
				]}
			/>
		)
	}

	return (
		<Toolbar
			modifiers={[
				navigationTitle(`Chapter ${Option.getOrElse(scrolledTo, () => props.number)}`),
				navigationBarTitleDisplayMode('inline')
			]}
		>
			<PageStrip
				pages={Array.flatMap(shown, chapter => chapter.pages)}
				start={Number.clamp(
					props.start ??
						pipe(
							Option.fromUndefinedOr(Array.headNonEmpty(shown).reading),
							Option.filter(reading => !reading.done),
							Option.match({onNone: () => 0, onSome: reading => reading.page})
						),
					{maximum: Number.max(Array.headNonEmpty(shown).pages.length - 1, 0), minimum: 0}
				)}
				onPage={event =>
					Option.match(
						Array.findFirst(Array.zip(shown, starts), pair => event.nativeEvent.index < pair[1] + pair[0].pages.length),
						{
							onNone: () => undefined,
							onSome: pair => {
								const chapter = pair[0]
								const page = event.nativeEvent.index - pair[1]
								// Passing into the next chapter finishes every page of the one before it.
								Option.match(
									Array.findFirst(shown, item => item.number === previous.current && item.number < chapter.number),
									{
										onNone: () => undefined,
										onSome: before => {
											finished.current = HashSet.add(finished.current, before.number)
											read({
												done: true,
												number: before.number,
												opened: true,
												page: before.pages.length - 1,
												series: before.series
											})
										}
									}
								)
								previous.current = chapter.number
								// A finished chapter stays finished while it is read again; only "Unread" in the list starts it over.
								if (page === chapter.pages.length - 1 || chapter.reading?.done === true) {
									finished.current = HashSet.add(finished.current, chapter.number)
								}
								read({
									done: HashSet.has(finished.current, chapter.number),
									number: chapter.number,
									opened: true,
									page,
									series: chapter.series
								})
								setScrolledTo(Option.some(chapter.number))
								if (chapter.number === Array.lastNonEmpty(shown).number && length < following.length) {
									setLength(length + 1)
								}
							}
						}
					)
				}
			/>
		</Toolbar>
	)
}
