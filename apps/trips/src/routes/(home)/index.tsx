import {useAtomMount, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, pipe} from 'effect'

import {
	Button,
	Circle,
	ContentUnavailableView,
	HStack,
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
	font,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	listRowBackground,
	listRowInsets,
	listRowSeparatorTint,
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
import {colors, text} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'

import {
	clipboardAtom,
	clipboardReturnsAtom,
	daysUntil,
	nowAtom,
	primary,
	removeAtom,
	restoreAtom,
	statusOf,
	timeAt,
	tones,
	undoAtom
} from '#lib/utils.ts'
import icon from '#routes/icon.png'
import {DAY, endOf, HOUR, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList} from '#services/bookings/schema.ts'

function zoneOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.timeZone
	return booking.from.timeZone
}

// "Bergamo to London", or the stay's name.
function headingOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	return `${booking.from.city ?? booking.from.name} to ${booking.to.city ?? booking.to.name}`
}

// "BGY 07:05 → STN 08:10" for a flight, "FR 9531 09:10 → 12:20" for a train, nights and check-in for a stay.
function scheduleOf(booking: Booking) {
	if (booking._tag === 'stay') {
		const nights = Number.round((booking.checkOut - booking.checkIn) / DAY, 0)
		return `${nights} ${Boolean.match(nights === 1, {onFalse: () => 'nights', onTrue: () => 'night'})} · check-in ${timeAt(booking.checkIn, booking.place.timeZone)}`
	}
	const departs = timeAt(startOf(booking), booking.from.timeZone)
	const arrives = timeAt(endOf(booking), booking.to.timeZone)
	if (booking._tag === 'train') return `${titleOf(booking)} ${departs} → ${arrives}`
	return `${booking.from.code ?? booking.from.name} ${departs} → ${booking.to.code ?? booking.to.name} ${arrives}`
}

// How far away a row is: "now" while it runs, the days until its day on its first row, nothing on the rest of that day.
type Countdown = {_tag: 'Now'} | {_tag: 'Days'; days: number} | {_tag: 'SameDay'}

function Gutter(props: {countdown: Countdown}) {
	return (
		<VStack spacing={1} modifiers={[frame({width: 34})]}>
			{props.countdown._tag === 'Now' && <Text modifiers={[text.data, foregroundStyle(primary)]}>now</Text>}
			{props.countdown._tag === 'Days' && (
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
		<SwipeActions
			modifiers={[
				listRowBackground(colors.background),
				listRowSeparatorTint(colors.border),
				listRowInsets({bottom: 10, leading: 12, top: 10, trailing: 16})
			]}
		>
			<HStack
				alignment="top"
				spacing={12}
				modifiers={[
					frame({alignment: 'leading', maxWidth: Infinity}),
					contentShape(shapes.rectangle()),
					onTapGesture(() => props.onOpen(props.booking.id)),
					accessibilityElement('combine')
				]}
			>
				<Gutter countdown={props.countdown} />
				<VStack alignment="leading" spacing={3} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
					<Text modifiers={[text.row, foregroundStyle(colors.foreground), lineLimit(1)]}>
						{headingOf(props.booking)}
					</Text>
					<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
						{scheduleOf(props.booking)}
					</Text>
					<HStack spacing={6}>
						<Circle modifiers={[foregroundStyle(tones[status.tone]), frame({height: 7, width: 7})]} />
						<Text modifiers={[text.detail, foregroundStyle(colors.foreground), lineLimit(1)]}>{status.label}</Text>
						{Option.match(status.where, {
							onNone: () => undefined,
							onSome: where => (
								<Text modifiers={[text.detail, foregroundStyle(tones[where.tone]), lineLimit(1)]}>· {where.text}</Text>
							)
						})}
					</HStack>
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
			tint={primary}
		/>
	)
}

// What runs now, then the days ahead counted down in the gutter, then the last month folded away.
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
	function daysOf(booking: Booking) {
		return daysUntil(startOf(booking), now, zoneOf(booking))
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
						tint(primary)
					]}
				>
					{Array.map(current, booking => (
						<BookingRow key={booking.id} booking={booking} countdown={{_tag: 'Now'}} now={now} onOpen={props.onOpen} />
					))}
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
									<Text modifiers={[text.detail]}>Reading booking…</Text>
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
