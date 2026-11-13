import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Number, Option, String, pipe} from 'effect'

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
import {FailureContent} from '@deslop/components-mobile/screens'
import {StatusDot} from '@deslop/components-mobile/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {bottomBarSearch} from '@deslop/components-mobile/toolbar'
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
import {blockingFailure} from '@deslop/runtime/client/live-stream'

import {bookingsAtom, clipboard, nowAtom, removal} from '#lib/bookings.ts'
import {session} from '#lib/session.ts'
import {daysUntil, primary, problemOf, statusOf, tones} from '#lib/status.ts'
import {clockAt, endOf, HOUR, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking} from '#services/bookings/schema.ts'

function zoneOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.timeZone
	return booking.from.timeZone
}

function headingOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	return `${Option.getOrElse(booking.from.city, () => booking.from.name)} to ${Option.getOrElse(booking.to.city, () => booking.to.name)}`
}

function scheduleOf(booking: Booking) {
	if (booking._tag === 'stay') {
		const nights = Number.round(Duration.toDays(DateTime.distance(booking.checkIn, booking.checkOut)), 0)
		return `${nights} ${Boolean.match(nights === 1, {onFalse: () => 'nights', onTrue: () => 'night'})} · check-in ${clockAt(booking.checkIn, booking.place.timeZone)}`
	}
	const departs = clockAt(startOf(booking), booking.from.timeZone)
	const arrives = clockAt(endOf(booking), booking.to.timeZone)
	if (booking._tag === 'train') return `${titleOf(booking)} ${departs} → ${arrives}`
	return `${titleOf(booking)} · ${Option.getOrElse(booking.from.code, () => booking.from.name)} ${departs} → ${Option.getOrElse(booking.to.code, () => booking.to.name)} ${arrives}`
}

// The schedule and the gate or platform it leaves from, each shown once.
function lineOf(booking: Booking, status: ReturnType<typeof statusOf>) {
	const where = Option.getOrElse(status.where, () => '')
	return pipe([scheduleOf(booking), where], Array.filter(String.isNonEmpty), Array.join(' · '))
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

function BookingRow(props: {
	booking: Booking
	countdown: Countdown
	now: DateTime.Utc
	onOpen: (id: Booking['id']) => void
}) {
	const machine = removal.machine(props.booking.id)
	const remove = useAtomSet(removal.removeAtom)
	const send = useAtomSet(machine.send)
	const status = statusOf(props.booking, props.now)
	return (
		<>
			<MachineState machine={machine} path="Idle">
				{() => (
					<SwipeActions modifiers={itemRow}>
						<Item alignment="top" onPress={() => props.onOpen(props.booking.id)}>
							<ItemMedia>
								<Gutter countdown={props.countdown} />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>{headingOf(props.booking)}</ItemTitle>
								<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>
									{lineOf(props.booking, status)}
								</Text>
							</ItemContent>
							{Option.match(problemOf(props.booking, status, props.now), {
								onNone: Function.constUndefined,
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
							<Button label="Delete" systemImage="trash" role="destructive" onPress={() => remove(props.booking.id)} />
						</SwipeActions.Actions>
					</SwipeActions>
				)}
			</MachineState>
			<MachineState machine={machine} path="Pending">
				{() => (
					<Item alignment="top" modifiers={itemRow}>
						<ItemMedia>
							<Gutter countdown={props.countdown} />
						</ItemMedia>
						<ItemContent>
							<ItemTitle modifiers={[foregroundStyle(colors.mutedForeground)]}>{headingOf(props.booking)}</ItemTitle>
							<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>
								{lineOf(props.booking, status)}
							</Text>
						</ItemContent>
						<ItemActions>
							<Button
								label="Undo"
								systemImage="arrow.uturn.backward"
								onPress={() => send({_tag: 'Restored'})}
								modifiers={[labelStyle('iconOnly')]}
							/>
						</ItemActions>
					</Item>
				)}
			</MachineState>
		</>
	)
}

function matchesOf(bookings: readonly Booking[], searched: string) {
	const needle = String.toLowerCase(String.trim(searched))
	return Array.filter(
		bookings,
		booking =>
			String.isEmpty(needle) ||
			String.includes(needle)(String.toLowerCase(`${headingOf(booking)} ${scheduleOf(booking)}`))
	)
}

function PastBookings(props: {
	bookings: readonly Booking[]
	expanded: boolean
	now: DateTime.Utc
	onExpandedChange: (expanded: boolean) => void
	onOpen: (id: Booking['id']) => void
}) {
	if (Array.isReadonlyArrayEmpty(props.bookings)) return undefined
	return (
		<Section title="Past" isExpanded={props.expanded} onIsExpandedChange={props.onExpandedChange}>
			{Array.map(props.bookings, booking => (
				<BookingRow
					key={booking.id}
					booking={booking}
					countdown={{_tag: 'SameDay'}}
					now={props.now}
					onOpen={props.onOpen}
				/>
			))}
		</Section>
	)
}

function Bookings(props: {onOpen: (id: Booking['id']) => void; searched: string}) {
	const loaded = useAtomSuspense(bookingsAtom, {includeFailure: true})
	const refresh = useAtomRefresh(bookingsAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const [pastOpen, setPastOpen] = useState(false)

	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), DateTime.nowUnsafe)
	const adding = pipe(
		useMachineResult(AtomMachine.select(clipboard.atom, 'Answering')),
		AsyncResult.value,
		Option.flatten,
		Option.exists(current => current.save)
	)
	const blocking = Option.getOrUndefined(blockingFailure(loaded))
	if (blocking !== undefined) return <FailureContent cause={blocking} onRetry={refresh} />
	const bookings = AsyncResult.getOrElse(loaded, () => [])
	const matches = matchesOf(bookings, props.searched)
	const current = Array.filter(
		matches,
		booking =>
			pipe(startOf(booking), DateTime.subtractDuration(Duration.hours(6)), DateTime.isLessThanOrEqualTo(now)) &&
			pipe(endOf(booking), DateTime.addDuration(HOUR), DateTime.isGreaterThanOrEqualTo(now))
	)
	const ahead = Array.filter(matches, booking =>
		pipe(startOf(booking), DateTime.subtractDuration(Duration.hours(6)), DateTime.isGreaterThan(now))
	)
	const past = Array.reverse(
		Array.filter(
			matches,
			booking =>
				pipe(endOf(booking), DateTime.addDuration(HOUR), DateTime.isLessThan(now)) &&
				DateTime.isGreaterThan(endOf(booking), DateTime.subtractDuration(now, Duration.days(30)))
		)
	)
	function daysOf(booking: Booking) {
		return daysUntil(startOf(booking), now, zoneOf(booking))
	}
	// One root: a SwiftUI modifier on several sibling views applies to each, so the dialog and the toolbar would repeat.
	return (
		<VStack spacing={0} modifiers={[frame({maxHeight: Infinity})]}>
			{AsyncResult.isFailure(loaded) && (
				<HStack modifiers={[frame({alignment: 'trailing', maxWidth: Infinity}), padding({horizontal: space[4]})]}>
					<Problem label="Out of date" onRetry={refresh} />
				</HStack>
			)}
			{adding && (
				<ItemGroupSkeleton rows={1} descriptionLines={2} media={<Gutter countdown={{_tag: 'Days', days: 2}} />} />
			)}
			{Array.isReadonlyArrayEmpty(bookings) && !adding && (
				<Empty>
					<EmptyAction
						label="Paste Booking"
						systemImage="doc.text"
						onPress={() => paste({_tag: 'Returned'})}
						tint={primary}
					/>
				</Empty>
			)}
			{Array.isReadonlyArrayNonEmpty(bookings) && Array.isReadonlyArrayEmpty(matches) && (
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
									countdown={pipe(
										ahead,
										Array.get(position - 1),
										Option.match({
											onNone: () => ({_tag: 'Days', days: daysOf(booking)}) as const,
											onSome: before =>
												Boolean.match(daysOf(before) === daysOf(booking), {
													onFalse: () => ({_tag: 'Days', days: daysOf(booking)}) as const,
													onTrue: () => ({_tag: 'SameDay'}) as const
												})
										})
									)}
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
					<PastBookings
						bookings={past}
						expanded={pastOpen}
						now={now}
						onExpandedChange={setPastOpen}
						onOpen={props.onOpen}
					/>
				</ItemGroup>
			)}
		</VStack>
	)
}

// Native navigation and clipboard/account controls do not wait for the bookings stream.
export function HomeRoute(props: {onOpen: (id: Booking['id']) => void}) {
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
			</Toolbar.Content>
		</Toolbar>
	)
}
