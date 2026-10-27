import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, DateTime, Option, Record} from 'effect'

import {
	Button,
	ContentUnavailableView,
	HStack,
	Image,
	List,
	Section,
	SwipeActions,
	Text,
	Toolbar,
	ToolbarItem,
	VStack
} from '@expo/ui/swift-ui'
import {
	accessibilityElement,
	background,
	contentShape,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparator,
	listStyle,
	navigationBarTitleDisplayMode,
	navigationTitle,
	onTapGesture,
	scrollContentBackground,
	shapes,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {colors, mono} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'

import {dayAt, deletedAtom, nowAtom, removeAtom, restoreAtom, statusOf, timeAt, tones} from '#lib/utils.ts'
import icon from '#routes/icon.png'
import {DAY, endOf, HOUR, routeOf, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList} from '#services/bookings/schema.ts'

const SYMBOLS = {flight: 'airplane', stay: 'bed.double.fill', train: 'tram.fill'} as const

function zoneOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.timeZone
	return booking.from.timeZone
}

function headingOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	return `${titleOf(booking)} · ${routeOf(booking)}`
}

function scheduleOf(booking: Booking) {
	if (booking._tag === 'stay') {
		return `${dayAt(booking.checkIn, booking.place.timeZone)} – ${dayAt(booking.checkOut, booking.place.timeZone)}`
	}
	return `${timeAt(startOf(booking), booking.from.timeZone)} – ${timeAt(endOf(booking), booking.to.timeZone)}`
}

function BookingRow(props: {booking: Booking; now: number; onOpen: (id: string) => void}) {
	const remove = useAtomSet(removeAtom)
	const status = statusOf(props.booking, props.now)
	return (
		<SwipeActions
			modifiers={[
				listRowBackground(colors.background),
				listRowSeparator('hidden'),
				listRowInsets({bottom: 8, leading: 16, top: 8, trailing: 16})
			]}
		>
			<HStack
				spacing={12}
				modifiers={[
					frame({alignment: 'leading', maxWidth: Infinity}),
					contentShape(shapes.rectangle()),
					onTapGesture(() => props.onOpen(props.booking.id)),
					accessibilityElement('combine')
				]}
			>
				<Image
					systemName={SYMBOLS[props.booking._tag]}
					size={17}
					color={colors.mutedForeground}
					modifiers={[frame({width: 26})]}
				/>
				<VStack alignment="leading" spacing={3} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
					<Text modifiers={[mono('headline', 15), foregroundStyle(colors.foreground), lineLimit(2)]}>
						{headingOf(props.booking)}
					</Text>
					<Text modifiers={[mono('subheadline', 13), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{scheduleOf(props.booking)}
					</Text>
				</VStack>
				<VStack alignment="trailing" spacing={3}>
					<Text modifiers={[mono('subheadline', 13), foregroundStyle(tones[status.tone]), lineLimit(1)]}>
						{status.label}
					</Text>
					{Option.match(status.where, {
						onNone: () => undefined,
						onSome: where => (
							<Text modifiers={[mono('subheadline', 13), foregroundStyle(tones[where.tone]), lineLimit(1)]}>
								{where.text}
							</Text>
						)
					})}
				</VStack>
			</HStack>
			<SwipeActions.Actions edge="trailing">
				<Button label="Delete" systemImage="trash" role="destructive" onPress={() => remove(props.booking)} />
			</SwipeActions.Actions>
		</SwipeActions>
	)
}

// Now, then the days ahead, then the last month folded away.
export function HomeRoute(props: {bookings: BookingList; onAdd: () => void; onOpen: (id: string) => void}) {
	const [pastOpen, setPastOpen] = useState(false)
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	const deleted = useAtomValue(deletedAtom)
	const restore = useAtomSet(restoreAtom)
	const current = Array.filter(
		props.bookings,
		booking => startOf(booking) - 6 * HOUR <= now && endOf(booking) + HOUR >= now
	)
	const ahead = Array.filter(props.bookings, booking => startOf(booking) - 6 * HOUR > now)
	const past = Array.reverse(
		Array.filter(props.bookings, booking => endOf(booking) + HOUR < now && endOf(booking) > now - 30 * DAY)
	)
	const days = Array.groupBy(ahead, booking => dayAt(startOf(booking), zoneOf(booking)))
	const order = Array.dedupe(Array.map(ahead, booking => dayAt(startOf(booking), zoneOf(booking))))
	function row(booking: Booking) {
		return <BookingRow key={booking.id} booking={booking} now={now} onOpen={props.onOpen} />
	}
	return (
		<Toolbar
			modifiers={[navigationTitle('Trips'), navigationBarTitleDisplayMode('inline'), background(colors.background)]}
		>
			{Array.isReadonlyArrayEmpty(props.bookings) && (
				<ContentUnavailableView
					title="No Trips Yet"
					systemImage="airplane"
					description="Paste a confirmation with +, or ask an agent to save one."
				/>
			)}
			{Array.isReadonlyArrayNonEmpty(props.bookings) &&
				Array.isReadonlyArrayEmpty(current) &&
				Array.isReadonlyArrayEmpty(ahead) &&
				Array.isReadonlyArrayEmpty(past) && (
					<ContentUnavailableView
						title="No Upcoming Trips"
						systemImage="airplane"
						description="Trips from more than a month ago are hidden; paste a new confirmation with +."
					/>
				)}
			{Array.isReadonlyArrayNonEmpty([...current, ...ahead, ...past]) && (
				<List
					modifiers={[
						listStyle('plain'),
						scrollContentBackground('hidden'),
						background(colors.background),
						tint(colors.primary)
					]}
				>
					{Array.isReadonlyArrayNonEmpty(current) && <Section title="Now">{Array.map(current, row)}</Section>}
					{Array.map(order, day => (
						<Section key={day} title={day}>
							{Array.map(
								Option.getOrElse(Record.get(days, day), () => []),
								row
							)}
						</Section>
					))}
					{Array.isReadonlyArrayNonEmpty(past) && (
						<Section title="Past" isExpanded={pastOpen} onIsExpandedChange={setPastOpen}>
							{Array.map(past, row)}
						</Section>
					)}
				</List>
			)}
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<AppTitle logo={icon} name="trips" />
				</ToolbarItem>
				<ToolbarItem placement="topBarTrailing">
					<Button label="Add Booking" systemImage="plus" onPress={props.onAdd} modifiers={[labelStyle('iconOnly')]} />
				</ToolbarItem>
				{Option.match(deleted, {
					onNone: () => undefined,
					onSome: booking => (
						<ToolbarItem placement="bottomBar">
							<Button
								label={`Undo Delete ${titleOf(booking)}`}
								systemImage="arrow.uturn.backward"
								onPress={() => restore(booking)}
								modifiers={[labelStyle('titleAndIcon'), lineLimit(1)]}
							/>
						</ToolbarItem>
					)
				})}
			</Toolbar.Content>
		</Toolbar>
	)
}
