import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Result, String, pipe} from 'effect'

import {
	Button,
	HStack,
	Section,
	SwipeActions,
	Text,
	Toolbar,
	ToolbarItem,
	useNativeState,
	VStack
} from '@expo/ui/swift-ui'
import {
	fixedSize,
	font,
	foregroundStyle,
	frame,
	labelStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	padding,
	searchable,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState, useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AccountMenu} from '@deslop/components-mobile/account'
import {PasteSheet} from '@deslop/components-mobile/paste-sheet'
import {Problem} from '@deslop/components-mobile/problem'
import {FailureContent, shownOf} from '@deslop/components-mobile/screens'
import {StatusDot} from '@deslop/components-mobile/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Empty, EmptyAction} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {bottomBarSearch} from '@deslop/components-mobile/utils'

import {
	clipboard,
	bookingsAtom,
	daysUntil,
	nowAtom,
	primary,
	problemOf,
	removeAtom,
	restoreAtom,
	session,
	statusOf,
	timeAt,
	tones,
	undoAtom
} from '#lib/utils.ts'
import {DAY, endOf, HOUR, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking} from '#services/bookings/schema.ts'

function zoneOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.timeZone
	return booking.from.timeZone
}

function headingOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	return `${booking.from.city ?? booking.from.name} to ${booking.to.city ?? booking.to.name}`
}

function scheduleOf(booking: Booking) {
	if (booking._tag === 'stay') {
		const nights = Number.round((booking.checkOut - booking.checkIn) / DAY, 0)
		return `${nights} ${Boolean.match(nights === 1, {onFalse: () => 'nights', onTrue: () => 'night'})} · check-in ${timeAt(booking.checkIn, booking.place.timeZone)}`
	}
	const departs = timeAt(startOf(booking), booking.from.timeZone)
	const arrives = timeAt(endOf(booking), booking.to.timeZone)
	if (booking._tag === 'train') return `${titleOf(booking)} ${departs} → ${arrives}`
	return `${titleOf(booking)} · ${booking.from.code ?? booking.from.name} ${departs} → ${booking.to.code ?? booking.to.name} ${arrives}`
}

// The schedule and the gate or platform it leaves from, each shown once.
function lineOf(booking: Booking, status: ReturnType<typeof statusOf>) {
	const where = Option.match(status.where, {onNone: () => '', onSome: found => found.text})
	return Array.join(Array.filter([scheduleOf(booking), where], String.isNonEmpty), ' · ')
}

type Countdown = {_tag: 'Now'} | {_tag: 'Days'; days: number} | {_tag: 'SameDay'}

function Gutter(props: {countdown: Countdown}) {
	return (
		<VStack spacing={0} modifiers={[fixedSize({horizontal: true, vertical: false}), frame({minWidth: 34})]}>
			{props.countdown._tag === 'Now' && <Text modifiers={[text.data, foregroundStyle(primary)]}>now</Text>}
			{props.countdown._tag === 'Days' && props.countdown.days < 1 && (
				<Text modifiers={[text.data, foregroundStyle(colors.foreground)]}>today</Text>
			)}
			{props.countdown._tag === 'Days' && props.countdown.days >= 1 && (
				<>
					<Text
						modifiers={[
							font({design: 'monospaced', textStyle: 'title3', weight: 'medium'}),
							foregroundStyle(colors.foreground)
						]}
					>
						{props.countdown.days}
					</Text>
					<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground)]}>
						{Boolean.match(props.countdown.days === 1, {onFalse: () => 'days', onTrue: () => 'day'})}
					</Text>
				</>
			)}
		</VStack>
	)
}

function BookingRow(props: {booking: Booking; countdown: Countdown; now: number; onOpen: (id: string) => void}) {
	const remove = useAtomSet(removeAtom)
	const status = statusOf(props.booking, props.now)
	return (
		<SwipeActions modifiers={itemRow}>
			<Item alignment="top" onPress={() => props.onOpen(props.booking.id)}>
				<ItemMedia>
					<Gutter countdown={props.countdown} />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{headingOf(props.booking)}</ItemTitle>
					<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>{lineOf(props.booking, status)}</Text>
				</ItemContent>
				{Option.match(problemOf(props.booking, status, props.now), {
					onNone: () => undefined,
					onSome: problem => (
						<ItemActions>
							<HStack spacing={space[2]}>
								<StatusDot status={problem.status} />
								<Text modifiers={[text.detail, foregroundStyle(tones[problem.tone])]}>{problem.label}</Text>
							</HStack>
						</ItemActions>
					)
				})}
			</Item>
			<SwipeActions.Actions edge="trailing">
				<Button label="Delete" systemImage="trash" role="destructive" onPress={() => remove(props.booking)} />
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

function Bookings(props: {onOpen: (id: string) => void; searched: string}) {
	const loaded = useAtomSuspense(bookingsAtom, {includeFailure: true})
	const refresh = useAtomRefresh(bookingsAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const [pastOpen, setPastOpen] = useState(false)
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	const adding = Option.exists(
		pipe(useMachineResult(AtomMachine.select(clipboard.atom, 'Answering')), AsyncResult.getOrElse(Option.none)),
		current => current.save
	)
	const shown = shownOf(loaded)
	if (Result.isFailure(shown)) {
		return <FailureContent cause={shown.failure} name="Trips" onRetry={refresh} />
	}
	const needle = String.toLowerCase(String.trim(props.searched))
	const matches = Array.filter(
		shown.success,
		booking =>
			String.isEmpty(needle) ||
			String.includes(needle)(String.toLowerCase(`${headingOf(booking)} ${scheduleOf(booking)}`))
	)
	const current = Array.filter(matches, booking => startOf(booking) - 6 * HOUR <= now && endOf(booking) + HOUR >= now)
	const ahead = Array.filter(matches, booking => startOf(booking) - 6 * HOUR > now)
	const past = Array.reverse(
		Array.filter(matches, booking => endOf(booking) + HOUR < now && endOf(booking) > now - 30 * DAY)
	)
	function daysOf(booking: Booking) {
		return daysUntil(startOf(booking), now, zoneOf(booking))
	}
	// One root: a SwiftUI modifier on several sibling views applies to each, so the dialog and the toolbar would repeat.
	return (
		<VStack spacing={0} modifiers={[frame({maxHeight: Infinity})]}>
			{AsyncResult.isFailure(loaded) && (
				<HStack modifiers={[frame({alignment: 'trailing', maxWidth: Infinity}), padding({horizontal: space[4]})]}>
					<Problem label="Bookings not updating" onRetry={refresh} />
				</HStack>
			)}
			{adding && (
				<ItemGroupSkeleton rows={1} descriptionLines={2} media={<Gutter countdown={{_tag: 'Days', days: 2}} />} />
			)}
			{Array.isReadonlyArrayEmpty(shown.success) && !adding && (
				<Empty>
					<EmptyAction
						label="Paste Booking"
						systemImage="doc.text"
						onPress={() => paste({_tag: 'Returned'})}
						tint={primary}
					/>
				</Empty>
			)}
			{Array.isReadonlyArrayNonEmpty(shown.success) && Array.isReadonlyArrayEmpty(matches) && (
				<Empty systemImage="magnifyingglass" label="No bookings match" />
			)}
			{Array.isReadonlyArrayNonEmpty(matches) && (
				<ItemGroup modifiers={[tint(primary)]}>
					{Array.isReadonlyArrayNonEmpty(current) && (
						<Section title="Now">
							{Array.map(current, booking => (
								<BookingRow
									key={booking.id}
									booking={booking}
									countdown={{_tag: 'Now'}}
									now={now}
									onOpen={props.onOpen}
								/>
							))}
						</Section>
					)}
					{Array.isReadonlyArrayNonEmpty(ahead) && (
						<Section title="Upcoming">
							{Array.map(ahead, (booking, position) => (
								<BookingRow
									key={booking.id}
									booking={booking}
									countdown={Option.match(Array.get(ahead, position - 1), {
										onNone: () => ({_tag: 'Days', days: daysOf(booking)}) as const,
										onSome: before =>
											Boolean.match(daysOf(before) === daysOf(booking), {
												onFalse: () => ({_tag: 'Days', days: daysOf(booking)}) as const,
												onTrue: () => ({_tag: 'SameDay'}) as const
											})
									})}
									now={now}
									onOpen={props.onOpen}
								/>
							))}
						</Section>
					)}
					{Array.isReadonlyArrayEmpty(current) && Array.isReadonlyArrayEmpty(ahead) && (
						<Section>
							<Empty systemImage="ticket" label="Nothing coming up" />
						</Section>
					)}
					{Array.isReadonlyArrayNonEmpty(past) && (
						<Section title="Past" isExpanded={pastOpen} onIsExpandedChange={setPastOpen}>
							{Array.map(past, booking => (
								<BookingRow
									key={booking.id}
									booking={booking}
									countdown={{_tag: 'SameDay'}}
									now={now}
									onOpen={props.onOpen}
								/>
							))}
						</Section>
					)}
				</ItemGroup>
			)}
		</VStack>
	)
}

// Native navigation and clipboard/account controls do not wait for the bookings stream.
export function HomeRoute(props: {onOpen: (id: string) => void}) {
	const restore = useAtomSet(restoreAtom)
	const query = useNativeState('')
	const [searched, setSearched] = useState('')
	return (
		<Toolbar
			modifiers={[
				navigationTitle('Trips'),
				navigationBarTitleDisplayMode('large'),
				searchable(query, {onChange: setSearched, prompt: 'Search'}),
				bottomBarSearch
			]}
		>
			<PasteSheet clipboard={clipboard}>
				<Suspense
					fallback={
						<ItemGroupSkeleton rows={10} descriptionLines={2} media={<Gutter countdown={{_tag: 'Days', days: 2}} />} />
					}
				>
					<Bookings onOpen={props.onOpen} searched={searched} />
				</Suspense>
			</PasteSheet>
			<Toolbar.Content>
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={session} />
				</ToolbarItem>
				<MachineState machine={undoAtom} path="Offered">
					{offered => (
						<ToolbarItem placement="bottomBar">
							<Button
								label={`Undo Delete ${titleOf(offered.value.booking)}`}
								systemImage="arrow.uturn.backward"
								onPress={() => restore(offered.value.booking)}
								modifiers={[labelStyle('titleAndIcon')]}
							/>
						</ToolbarItem>
					)}
				</MachineState>
			</Toolbar.Content>
		</Toolbar>
	)
}
