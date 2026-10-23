import {useAtomSet} from '@effect/atom-react'

import {Array, MutableHashSet, Option, pipe} from 'effect'

import {ContentUnavailableView} from '@expo/ui/swift-ui'
import {background, navigationBarTitleDisplayMode, navigationTitle} from '@expo/ui/swift-ui/modifiers'
import {useRef, useState} from 'react'

import {colors} from '@deslop/components-mobile/theme'

import {readAtom} from '#lib/utils.ts'
import {PageStrip} from '#modules/native/index.ts'
import {byNumber} from '#services/chapters/lib/utils.ts'
import type {ChapterList} from '#services/chapters/schema.ts'

// The opened chapter and the ones after it in one strip, so finishing a chapter scrolls straight into the next.
export function ReaderRoute(props: {chapters: ChapterList; number: number}) {
	const read = useAtomSet(readAtom)
	const following = pipe(
		Array.sort(props.chapters, byNumber),
		Array.filter(chapter => chapter.number >= props.number)
	)
	// The strip grows one chapter at a time as the reader reaches the last one in it.
	const [length, setLength] = useState(2)
	const [scrolledTo, setScrolledTo] = useState(Option.none<number>)
	const previous = useRef(props.number)
	// What this reader finished, so a page turn before the server's copy of the list arrives cannot unfinish it.
	const [finished] = useState(MutableHashSet.empty<number>)
	const shown = Array.take(following, length)
	// Where each chapter's first page sits in the strip.
	const starts = Array.scan(shown, 0, (total, chapter) => total + chapter.pages.length)

	if (!Array.isReadonlyArrayNonEmpty(shown)) {
		return (
			<ContentUnavailableView
				title="Chapter Unavailable"
				systemImage="book.closed"
				modifiers={[navigationTitle(''), background(colors.background)]}
			/>
		)
	}

	return (
		<PageStrip
			chapters={Array.map(shown, chapter => ({number: chapter.number, pages: chapter.pages}))}
			start={pipe(
				Option.fromUndefinedOr(Array.headNonEmpty(shown).reading),
				Option.filter(reading => !reading.done),
				Option.match({onNone: () => 0, onSome: reading => reading.page})
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
										MutableHashSet.add(finished, before.number)
										read({done: true, number: before.number, page: before.pages.length - 1})
									}
								}
							)
							previous.current = chapter.number
							// A finished chapter stays finished while it is read again; only "Unread" in the list starts it over.
							if (page === chapter.pages.length - 1 || chapter.reading?.done === true) {
								MutableHashSet.add(finished, chapter.number)
							}
							read({done: MutableHashSet.has(finished, chapter.number), number: chapter.number, page})
							setScrolledTo(Option.some(chapter.number))
							if (chapter.number === Array.lastNonEmpty(shown).number && length < following.length) {
								setLength(length + 1)
							}
						}
					}
				)
			}
			modifiers={[
				navigationTitle(`Chapter ${Option.getOrElse(scrolledTo, () => props.number)}`),
				navigationBarTitleDisplayMode('inline')
			]}
		/>
	)
}
