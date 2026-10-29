import {useAtomMount, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Option, Record, pipe} from 'effect'

import {
	Button,
	ContentUnavailableView,
	HStack,
	Image,
	List,
	ProgressView,
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
import {MachineState, useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {ClipboardSheet} from '@deslop/components-mobile/sheet'
import {colors, mono} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'

import {
	clipboardAtom,
	clipboardReturnsAtom,
	dayAt,
	nowAtom,
	removeAtom,
	restoreAtom,
	statusOf,
	timeAt,
	tones,
	undoAtom
} from '#lib/utils.ts'
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

function PasteSheet() {
	useAtomMount(clipboardReturnsAtom)
	const offer = pipe(useMachineResult(AtomMachine.select(clipboardAtom, 'Offered')), AsyncResult.getOrElse(Option.none))
	const send = useAtomSet(clipboardAtom.send)
	return (
		<ClipboardSheet
			anchor={<AppTitle logo={icon} name="trips" />}
			confirm="Add booking"
			detail={Boolean.match(
				Option.exists(offer, current => current.kind === 'image'),
				{onFalse: () => 'Copied text', onTrue: () => 'Copied screenshot'}
			)}
			onAnswer={save => send({_tag: 'Answered', save})}
			open={Option.isSome(offer)}
			question="Add from clipboard?"
			symbol="ticket"
		/>
	)
}

// Now, then the days ahead, then the last month folded away.
export function HomeRoute(props: {bookings: BookingList; onOpen: (id: string) => void}) {
	const [pastOpen, setPastOpen] = useState(false)
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
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
					title="No bookings"
					systemImage="ticket"
					description="Copy a confirmation or screenshot, then open Trips."
				/>
			)}
			{Array.isReadonlyArrayNonEmpty(props.bookings) &&
				Array.isReadonlyArrayEmpty(current) &&
				Array.isReadonlyArrayEmpty(ahead) &&
				Array.isReadonlyArrayEmpty(past) && (
					<ContentUnavailableView
						title="No upcoming bookings"
						systemImage="ticket"
						description="Copy a confirmation or screenshot, then open Trips. Bookings older than a month are hidden."
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
					<PasteSheet />
				</ToolbarItem>
				<MachineState machine={clipboardAtom} path="Answering">
					{answering =>
						answering.value.save && (
							<ToolbarItem placement="bottomBar">
								<ProgressView>
									<Text modifiers={[mono('caption', 12)]}>Reading booking…</Text>
								</ProgressView>
							</ToolbarItem>
						)
					}
				</MachineState>
				<MachineState machine={undoAtom} path="Offered">
					{offered => (
						<ToolbarItem placement="bottomBar">
							<Button
								label={`Undo Delete ${titleOf(offered.value.booking)}`}
								systemImage="arrow.uturn.backward"
								onPress={() => restore(offered.value.booking)}
								modifiers={[labelStyle('titleAndIcon'), lineLimit(1)]}
							/>
						</ToolbarItem>
					)}
				</MachineState>
			</Toolbar.Content>
		</Toolbar>
	)
}
