import {useAtomMount, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Result, pipe} from 'effect'

import {Button, HStack, Section, SwipeActions, Text, Toolbar, ToolbarItem, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	background,
	fixedSize,
	font,
	foregroundStyle,
	frame,
	labelStyle,
	lineLimit,
	navigationBarTitleDisplayMode,
	navigationTitle,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {MachineState, useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AccountMenu} from '@deslop/components-mobile/account'
import {FailureContent, shownOf} from '@deslop/components-mobile/screens'
import {ClipboardSheet} from '@deslop/components-mobile/sheet'
import {StatusDot} from '@deslop/components-mobile/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {AppTitle} from '@deslop/components-mobile/title'
import {Empty, EmptyHeader, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
	itemRow
} from '@deslop/components-mobile/ui/item'
import {ItemGroupSkeleton} from '@deslop/components-mobile/ui/skeleton'
import {Spinner} from '@deslop/components-mobile/ui/spinner'

import {
	clipboardAtom,
	clipboardReturnsAtom,
	bookingsAtom,
	daysUntil,
	dots,
	nowAtom,
	primary,
	removeAtom,
	restoreAtom,
	session,
	statusOf,
	timeAt,
	tones,
	undoAtom
} from '#lib/utils.ts'
import icon from '#routes/icon.png'
import {DAY, endOf, HOUR, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import type {Booking} from '#services/bookings/schema.ts'

function zoneOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.timeZone
	return booking.from.timeZone
}

// "Bergamo to London", or the stay's name.
function headingOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	return `${booking.from.city ?? booking.from.name} to ${booking.to.city ?? booking.to.name}`
}

// "FR 4512 · BGY 07:05 → STN 08:10" for a flight, "FR 9531 09:10 → 12:20" for a train, nights and check-in for a stay.
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

// How far away a row is: now, today, or days until its day on its first row; blank for the rest of that day.
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
					<ItemTitle modifiers={[lineLimit(1)]}>{headingOf(props.booking)}</ItemTitle>
					<ItemDescription modifiers={[text.data]}>{scheduleOf(props.booking)}</ItemDescription>
					<HStack spacing={space[2]}>
						<StatusDot status={dots[status.tone]} tint={primary} />
						<Text modifiers={[text.detail, foregroundStyle(colors.foreground), lineLimit(1)]}>{status.label}</Text>
						{Option.match(status.where, {
							onNone: () => undefined,
							onSome: where => (
								<Text modifiers={[text.detail, foregroundStyle(tones[where.tone]), lineLimit(1)]}>· {where.text}</Text>
							)
						})}
					</HStack>
				</ItemContent>
			</Item>
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
function Bookings(props: {onOpen: (id: string) => void}) {
	const loaded = useAtomSuspense(bookingsAtom, {includeFailure: true})
	const refresh = useAtomRefresh(bookingsAtom)
	const [pastOpen, setPastOpen] = useState(false)
	const now = AsyncResult.getOrElse(useAtomValue(nowAtom), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
	const shown = shownOf(loaded)
	if (Result.isFailure(shown)) {
		return <FailureContent cause={shown.failure} name="Trips" onRetry={refresh} />
	}
	const current = Array.filter(
		shown.success,
		booking => startOf(booking) - 6 * HOUR <= now && endOf(booking) + HOUR >= now
	)
	const ahead = Array.filter(shown.success, booking => startOf(booking) - 6 * HOUR > now)
	const past = Array.reverse(
		Array.filter(shown.success, booking => endOf(booking) + HOUR < now && endOf(booking) > now - 30 * DAY)
	)
	function daysOf(booking: Booking) {
		return daysUntil(startOf(booking), now, zoneOf(booking))
	}
	return (
		<>
			{Array.isReadonlyArrayEmpty(shown.success) && (
				<Empty modifiers={[accessibilityLabel('No bookings')]}>
					<EmptyHeader>
						<EmptyMedia systemImage="ticket" />
					</EmptyHeader>
				</Empty>
			)}
			{Array.isReadonlyArrayNonEmpty(shown.success) &&
				Array.isReadonlyArrayEmpty(current) &&
				Array.isReadonlyArrayEmpty(ahead) &&
				Array.isReadonlyArrayEmpty(past) && (
					<Empty modifiers={[accessibilityLabel('No upcoming bookings')]}>
						<EmptyHeader>
							<EmptyMedia systemImage="ticket" />
						</EmptyHeader>
					</Empty>
				)}
			{Array.isReadonlyArrayNonEmpty([...current, ...ahead, ...past]) && (
				<ItemGroup modifiers={[tint(primary)]}>
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
				</ItemGroup>
			)}
		</>
	)
}

// Native navigation and clipboard/account controls do not wait for the bookings stream.
export function HomeRoute(props: {onOpen: (id: string) => void}) {
	const restore = useAtomSet(restoreAtom)
	return (
		<Toolbar modifiers={[navigationTitle(''), navigationBarTitleDisplayMode('inline'), background(colors.background)]}>
			<Suspense
				fallback={
					<ItemGroupSkeleton rows={10} descriptionLines={2} media={<Gutter countdown={{_tag: 'Days', days: 2}} />} />
				}
			>
				<Bookings onOpen={props.onOpen} />
			</Suspense>
			<Toolbar.Content>
				<ToolbarItem placement="principal">
					<PasteSheet />
				</ToolbarItem>
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={session.machine} />
				</ToolbarItem>
				<MachineState machine={clipboardAtom} path="Answering">
					{answering =>
						answering.value.save && (
							<ToolbarItem placement="bottomBar">
								<Spinner label="Reading booking…" />
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
