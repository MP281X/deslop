import {useAtom, useAtomMount, useAtomRefresh, useAtomSet, useAtomSubscribe, useAtomValue} from '@effect/atom-react'

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
	font,
	foregroundStyle,
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
import {useListChoose, useListSearch} from '@deslop/components-mobile/blocks/list-detail'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {Loaded} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {colors, radius} from '@deslop/components-mobile/theme'
import {Empty, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {problemSinceAtom} from '@deslop/runtime/client/problem'
import {dayOf} from '@deslop/runtime/shared/format'

import {chaptersAtom, openedAtom, readAtom, unsavedAtom} from '#lib/chapters.ts'
import {withUnsaved} from '#lib/reader.ts'
import {primary, session} from '#lib/session.ts'
import {ChapterProgress, Cover} from '#modules/native/index.ts'
import {byNumber, SERIES_NAMES} from '#services/chapters/lib/utils.ts'
import type {ChapterNumber, ChapterItem} from '#services/chapters/schema.ts'
import {Series} from '#services/chapters/schema.ts'

// Every prop keeps its identity while the chapter is unchanged, so a page turn in the reader re-renders one row.
function ChapterRow(props: {chapter: ChapterItem; onOpen: (number: ChapterNumber) => void}) {
	const now = useAtomValue(clockAtom('1 minute'))
	const read = useAtomSet(readAtom)
	const choose = useListChoose()
	const done = Option.exists(props.chapter.reading, reading => reading.done)
	return (
		<SwipeActions modifiers={itemRow}>
			<Item
				onPress={() => {
					choose()
					props.onOpen(props.chapter.number)
				}}
			>
				<ItemMedia>
					<Cover
						url={Option.getOrElse(Array.head(props.chapter.pages), Function.constant(''))}
						modifiers={[
							frame({height: 68, width: 48}),
							clipShape('roundedRectangle', radius),
							opacity(Boolean.match(done, {onFalse: Function.constant(1), onTrue: Function.constant(0.45)})),
							accessibilityHidden(true)
						]}
					/>
				</ItemMedia>
				{/* Unread is bold, read recedes; the chapter number still leads the list. */}
				<ItemContent>
					<ItemTitle
						modifiers={Boolean.match(done, {
							onFalse: () => [font({textStyle: 'body', weight: 'bold'})],
							onTrue: () => [font({textStyle: 'body'}), foregroundStyle(colors.mutedForeground)]
						})}
					>{`Chapter ${props.chapter.number}`}</ItemTitle>
					<ItemDescription>
						{pipe(
							[
								props.chapter.title,
								Option.match(props.chapter.postedAt, {onNone: Function.constant(''), onSome: at => dayOf(at, now)})
							],
							Array.filter(String.isNonEmpty),
							Array.join(' · ')
						)}
					</ItemDescription>
				</ItemContent>
				{/* Weight already says unread or read, so progress shows only for a chapter left part-way; the pages before the one on screen are read. */}
				{pipe(
					props.chapter.reading,
					Option.filter(reading => !reading.done && reading.page > 0),
					Option.match({
						onNone: Function.constNull,
						onSome: reading => (
							<ItemActions>
								<ChapterProgress
									fraction={reading.page / Number.max(props.chapter.pages.length, 1)}
									accent={primary}
									read={colors.foreground}
									modifiers={[frame({height: 14, width: 14})]}
								/>
							</ItemActions>
						)
					})
				)}
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

function Chapters(props: {onOpen: (number: ChapterNumber, page?: number) => void; searched: string; series: Series}) {
	const unsaved = useAtomValue(unsavedAtom)
	return (
		<Loaded atom={chaptersAtom}>
			{all => {
				const chapters = Array.filter(withUnsaved(all, unsaved), chapter => chapter.series === props.series)
				const needle = String.toLowerCase(String.trim(props.searched))
				const matches = pipe(
					chapters,
					Array.sort(Order.flip(byNumber)),
					Array.filter(
						chapter =>
							String.startsWith(needle)(`${chapter.number}`) ||
							String.includes(needle)(String.toLowerCase(chapter.title))
					)
				)
				if (Array.isReadonlyArrayEmpty(chapters)) {
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
						<ItemGroup>
							<Section>
								{Array.map(matches, chapter => (
									<ChapterRow key={chapter.number} chapter={chapter} onOpen={props.onOpen} />
								))}
							</Section>
						</ItemGroup>
						{Array.isReadonlyArrayEmpty(matches) && (
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

// The query every copy of the list filters by, as the search field they share shows it, so the copy below the reader in laptop posture filters as the one beside it does.
const searchedAtom = Atom.make('')

export function ChaptersRoute(props: {
	onOpen: (number: ChapterNumber, page?: number) => void
	onSeries: (series: Series) => void
	series: Series
}) {
	const loaded = useAtomValue(chaptersAtom)
	useAtomMount(problemSinceAtom(chaptersAtom))
	const refresh = useAtomRefresh(chaptersAtom)
	const [searched, setSearched] = useAtom(searchedAtom)
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
						media={
							<ItemMedia>
								<Rectangle modifiers={[frame({height: 68, width: 48}), clipShape('roundedRectangle', radius)]} />
							</ItemMedia>
						}
					/>
				}
			>
				<Chapters onOpen={props.onOpen} searched={searched} series={props.series} />
			</Suspense>
		</ListToolbar>
	)
}
