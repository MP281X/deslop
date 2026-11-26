import {useAtomMount, useAtomRefresh, useAtomSet, useAtomSubscribe, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Number, Option, Order, String, pipe} from 'effect'

import {
	Button,
	Image,
	Menu,
	Overlay,
	Picker,
	Rectangle,
	Section,
	SwipeActions,
	Text,
	ToolbarItem
} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	accessibilityLabel,
	clipShape,
	frame,
	labelStyle,
	menuOrder,
	opacity,
	pickerStyle,
	tag,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {useListChoose, useListSearch, useListTiled} from '@deslop/components-mobile/blocks/list-detail'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {Loaded} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {Row} from '@deslop/components-mobile/blocks/row'
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {Item, ItemGroup, ItemMedia, itemRow} from '@deslop/components-mobile/ui/item'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {problemSinceAtom} from '@deslop/runtime/client/problem'
import {dayOf} from '@deslop/runtime/shared/format'

import {chaptersAtom, openedAtom, readAtom, unsavedAtom} from '#lib/chapters.ts'
import {withUnsaved} from '#lib/reader.ts'
import {primary, session} from '#lib/session.ts'
import {Cover} from '#modules/native/index.ts'
import {byNumber, SERIES_NAMES} from '#services/chapters/lib/utils.ts'
import type {ChapterNumber, ChapterItem} from '#services/chapters/schema.ts'
import {Series} from '#services/chapters/schema.ts'

// The query every copy of the list filters by, as the search field they share shows it, so the copy below the reader in laptop posture filters as the one beside it does.
const searchedAtom = Atom.make('')

// Every prop keeps its identity while the chapter is unchanged, so a page turn in the reader re-renders one row.
function ChapterRow(props: {chapter: ChapterItem; onOpen: (number: ChapterNumber) => void}) {
	const now = useAtomValue(clockAtom('1 minute'))
	const read = useAtomSet(readAtom)
	const choose = useListChoose()
	const done = Option.exists(props.chapter.reading, reading => reading.done)
	return (
		<SwipeActions modifiers={itemRow}>
			<Item
				size="xs"
				onPress={() => {
					choose()
					props.onOpen(props.chapter.number)
				}}
			>
				{/* A read chapter recedes; one left part-way shows the page it is on, the rest their length. */}
				<Row
					cover={
						<Cover
							url={Option.getOrElse(Array.head(props.chapter.pages), Function.constant(''))}
							modifiers={[
								frame({height: 40, width: 28}),
								clipShape('roundedRectangle', 4),
								opacity(Boolean.match(done, {onFalse: Function.constant(1), onTrue: Function.constant(0.45)})),
								accessibilityHidden(true)
							]}
						/>
					}
					title={`Chapter ${props.chapter.number}`}
					muted={done}
					line={Option.some(
						pipe(
							[
								props.chapter.title,
								Option.match(props.chapter.postedAt, {onNone: Function.constant(''), onSome: at => dayOf(at, now)})
							],
							Array.filter(String.isNonEmpty),
							Array.join(' · ')
						)
					)}
					problem={Option.none()}
					trailing={Option.some(
						pipe(
							props.chapter.reading,
							Option.filter(reading => !reading.done && reading.page > 0),
							Option.match({
								onNone: () => `${props.chapter.pages.length} p`,
								onSome: reading => `${reading.page + 1}/${props.chapter.pages.length}`
							})
						)
					)}
				/>
			</Item>
			<SwipeActions.Actions edge="leading">
				<Button
					label={Boolean.match(done, {onFalse: Function.constant('Read'), onTrue: Function.constant('Unread')})}
					systemImage={Boolean.match(done, {
						onFalse: Function.constant('checkmark.circle' as const),
						onTrue: Function.constant('circle' as const)
					})}
					onPress={() =>
						read({
							done: !done,
							number: props.chapter.number,
							page: Boolean.match(done, {
								onFalse: () => Number.max(props.chapter.pages.length - 1, 0),
								onTrue: Function.constant(0)
							}),
							series: props.chapter.series
						})
					}
					modifiers={[tint(primary)]}
				/>
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

// The series' chapters the search matches, newest first, and how many the series has.
function useMatches(series: Series) {
	const unsaved = useAtomValue(unsavedAtom)
	const searched = useAtomValue(searchedAtom)
	return (all: readonly ChapterItem[]) => {
		const chapters = Array.filter(withUnsaved(all, unsaved), chapter => chapter.series === series)
		const needle = String.toLowerCase(String.trim(searched))
		return {
			chapters,
			matches: pipe(
				chapters,
				Array.sort(Order.flip(byNumber)),
				Array.filter(
					chapter =>
						String.startsWith(needle)(`${chapter.number}`) || String.includes(needle)(String.toLowerCase(chapter.title))
				)
			)
		}
	}
}

// Where the newer half of the matches ends, when the older half stands in its own column beside them.
function halfOf(matches: readonly ChapterItem[]) {
	return Math.ceil(matches.length / 2)
}

function ChapterRows(props: {chapters: readonly ChapterItem[]; onOpen: (number: ChapterNumber) => void}) {
	return (
		<ItemGroup>
			<Section>
				{Array.map(props.chapters, chapter => (
					<ChapterRow key={chapter.number} chapter={chapter} onOpen={props.onOpen} />
				))}
			</Section>
		</ItemGroup>
	)
}

// With nothing opened beside it, the list keeps the newer half and `ChaptersColumn` shows the older half across the fold.
function Chapters(props: {onOpen: (number: ChapterNumber, page?: number) => void; opened: boolean; series: Series}) {
	const matchesOf = useMatches(props.series)
	const halved = useListTiled() && !props.opened
	return (
		<Loaded atom={chaptersAtom}>
			{all => {
				const found = matchesOf(all)
				if (Array.isReadonlyArrayEmpty(found.chapters)) {
					return (
						<Empty>
							<EmptyMedia>
								<Image systemName="book.closed" modifiers={[accessibilityLabel('No chapters')]} />
							</EmptyMedia>
						</Empty>
					)
				}
				return (
					// The no-match state sits over the list, centred on the screen, as SwiftUI's own apps show it.
					<Overlay>
						<ChapterRows
							chapters={Boolean.match(halved, {
								onFalse: () => found.matches,
								onTrue: () => Array.take(found.matches, halfOf(found.matches))
							})}
							onOpen={props.onOpen}
						/>
						{Array.isReadonlyArrayEmpty(found.matches) && (
							<Overlay.Content>
								<Empty>
									<EmptyMedia>
										<Image systemName="magnifyingglass" modifiers={[accessibilityLabel('No chapters match')]} />
									</EmptyMedia>
								</Empty>
							</Overlay.Content>
						)}
					</Overlay>
				)
			}}
		</Loaded>
	)
}

// The older half of the list's matches, beside the list while nothing is opened, so the inner screen shows two columns of chapters either side of the fold.
export function ChaptersColumn(props: {onOpen: (number: ChapterNumber) => void; series: Series}) {
	const matchesOf = useMatches(props.series)
	return (
		<Loaded atom={chaptersAtom}>
			{all => {
				const found = matchesOf(all)
				return <ChapterRows chapters={Array.drop(found.matches, halfOf(found.matches))} onOpen={props.onOpen} />
			}}
		</Loaded>
	)
}

export function ChaptersRoute(props: {
	onOpen: (number: ChapterNumber, page?: number) => void
	opened: boolean
	onSeries: (series: Series) => void
	series: Series
}) {
	const loaded = useAtomValue(chaptersAtom)
	useAtomMount(problemSinceAtom(chaptersAtom))
	const refresh = useAtomRefresh(chaptersAtom)
	const setSearched = useAtomSet(searchedAtom)
	const field = useListSearch()
	// Another series' list starts unfiltered, whether the person picks it or a notification opens one of its chapters.
	function clearSearch() {
		setSearched('')
		Option.match(field, {onNone: Function.constVoid, onSome: text => text.set('')})
	}
	useAtomSubscribe(openedAtom, opened => {
		if (Option.exists(opened, chapter => chapter.series !== props.series)) clearSearch()
	})
	// Chapters already on screen stay through an outage; a retryable problem dot in the bar marks that they stopped updating.
	return (
		<ListToolbar
			title={SERIES_NAMES[props.series]}
			session={session}
			onSearch={setSearched}
			problem={Option.liftPredicate(
				<Problem source={chaptersAtom} label="Out of date" onRetry={refresh} />,
				() => AsyncResult.isFailure(loaded) && Option.isNone(blockingFailure(loaded))
			)}
			bottomBar={
				<ToolbarItem placement="bottomBar">
					<Menu
						label={SERIES_NAMES[props.series]}
						systemImage="books.vertical"
						modifiers={[
							labelStyle('iconOnly'),
							menuOrder('fixed'),
							accessibilityLabel(`Series: ${SERIES_NAMES[props.series]}`)
						]}
					>
						<Picker<Series>
							label="Series"
							selection={props.series}
							onSelectionChange={series => {
								clearSearch()
								props.onSeries(series)
							}}
							modifiers={[pickerStyle('inline')]}
						>
							{Array.map(Series.literals, series => (
								<Text key={series} modifiers={[tag(series)]}>
									{SERIES_NAMES[series]}
								</Text>
							))}
						</Picker>
					</Menu>
				</ToolbarItem>
			}
		>
			<Suspense
				fallback={
					<ItemGroupSkeleton
						rows={10}
						descriptionLines={1}
						media={
							<ItemMedia>
								<Rectangle modifiers={[frame({height: 40, width: 28}), clipShape('roundedRectangle', 4)]} />
							</ItemMedia>
						}
					/>
				}
			>
				<Chapters onOpen={props.onOpen} opened={props.opened} series={props.series} />
			</Suspense>
		</ListToolbar>
	)
}
