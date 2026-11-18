import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Number, Option, Schema, String, pipe} from 'effect'

import {HStack, Image, Overlay, Section, Text, VStack} from '@expo/ui/swift-ui'
import {accessibilityLabel, fixedSize, font, foregroundStyle, frame, tint} from '@expo/ui/swift-ui/modifiers'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {FailureContent} from '@deslop/components-mobile/blocks/loaded'
import {PasteSheet} from '@deslop/components-mobile/blocks/paste-sheet'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {RemovableRow} from '@deslop/components-mobile/blocks/removable-row'
import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle} from '@deslop/components-mobile/ui/item'
import {blockingFailure} from '@deslop/runtime/client/live-stream'

import {bookingsAtom, clipboard, nowAtom, removal} from '#lib/bookings.ts'
import {primary, session} from '#lib/session.ts'
import {currentOf, daysUntil, problemOf, statusOf, tones} from '#lib/status.ts'
import {clockAt, endOf, HOUR, journeysOf, startOf, titleOf} from '#services/bookings/lib/utils.ts'
import {Booking} from '#services/bookings/schema.ts'

type Journey = Array.NonEmptyReadonlyArray<Booking>

function startOfJourney(journey: Journey) {
	return startOf(Array.headNonEmpty(journey))
}

function endOfJourney(journey: Journey) {
	return endOf(Array.lastNonEmpty(journey))
}

function zoneOf(journey: Journey) {
	const first = Array.headNonEmpty(journey)
	if (Booking.isAnyOf(['stay'])(first)) return first.place.timeZone
	return first.from.timeZone
}

function headingOf(journey: Journey) {
	const first = Array.headNonEmpty(journey)
	if (Booking.isAnyOf(['stay'])(first)) return first.name
	const last = Option.getOrElse(Array.last(Array.filter(journey, Booking.isAnyOf(['flight', 'train']))), () => first)
	return `${Option.getOrElse(first.from.city, () => first.from.name)} to ${Option.getOrElse(last.to.city, () => last.to.name)}`
}

function scheduleOf(journey: Journey) {
	const first = Array.headNonEmpty(journey)
	if (Booking.isAnyOf(['stay'])(first)) {
		const nights = Number.round(Duration.toDays(DateTime.distance(first.checkIn, first.checkOut)), 0)
		return `${nights} ${Boolean.match(nights === 1, {onFalse: Function.constant('nights'), onTrue: Function.constant('night')})} · check-in ${clockAt(first.checkIn, first.place.timeZone)}`
	}
	const last = Option.getOrElse(Array.last(Array.filter(journey, Booking.isAnyOf(['flight', 'train']))), () => first)
	const departs = clockAt(startOfJourney(journey), first.from.timeZone)
	const arrives = clockAt(endOfJourney(journey), last.to.timeZone)
	if (Booking.isAnyOf(['train'])(first)) {
		return `${pipe(journey, Array.map(titleOf), Array.join(' · '))} ${departs} → ${arrives}`
	}
	return `${titleOf(first)} · ${Option.getOrElse(first.from.code, () => first.from.name)} ${departs} → ${Option.getOrElse(last.to.code, () => last.to.name)} ${arrives}`
}

// The schedule and the gate or platform it leaves from, each shown once.
function lineOf(journey: Journey, status: ReturnType<typeof statusOf>) {
	const where = Option.getOrElse(status.where, Function.constant(''))
	return pipe([scheduleOf(journey), where], Array.filter(String.isNonEmpty), Array.join(' · '))
}

type Countdown = typeof Countdown.Type
const Countdown = Schema.TaggedUnion({Days: {days: Schema.Finite}, Now: {}, SameDay: {}})

function Gutter(props: {countdown: Countdown}) {
	return (
		<VStack spacing={0} modifiers={[fixedSize({horizontal: true, vertical: false}), frame({minWidth: 34})]}>
			{Countdown.isAnyOf(['Now'])(props.countdown) && (
				<Text modifiers={[text.data, foregroundStyle(primary)]}>now</Text>
			)}
			{Countdown.isAnyOf(['Days'])(props.countdown) && props.countdown.days < 1 && (
				<Text modifiers={[text.data, foregroundStyle(colors.foreground)]}>today</Text>
			)}
			{Countdown.isAnyOf(['Days'])(props.countdown) && props.countdown.days >= 1 && (
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
						{Boolean.match(props.countdown.days === 1, {
							onFalse: Function.constant('days'),
							onTrue: Function.constant('day')
						})}
					</Text>
				</>
			)}
		</VStack>
	)
}

function BookingRow(props: {
	journey: Journey
	countdown: Countdown
	now: DateTime.Utc
	onOpen: (id: Booking['id']) => void
}) {
	const status = statusOf(currentOf(props.journey, props.now), props.now)
	return (
		<RemovableRow
			alignment="top"
			id={Array.headNonEmpty(props.journey).id}
			removal={removal}
			onOpen={() => props.onOpen(Array.headNonEmpty(props.journey).id)}
		>
			{pending => (
				<>
					<ItemMedia>
						<Gutter countdown={props.countdown} />
					</ItemMedia>
					<ItemContent>
						<ItemTitle
							modifiers={Boolean.match(pending, {
								onFalse: () => [],
								onTrue: () => [foregroundStyle(colors.mutedForeground)]
							})}
						>
							{headingOf(props.journey)}
						</ItemTitle>
						<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>
							{lineOf(props.journey, status)}
						</Text>
					</ItemContent>
					{pipe(
						props.journey,
						Array.findFirst(leg => problemOf(leg, statusOf(leg, props.now), props.now)),
						Option.filter(() => !pending),
						Option.match({
							onNone: Function.constUndefined,
							onSome: problem => (
								<ItemActions>
									<HStack spacing={space[2]}>
										<StatusDot status={problem.status} />
										<Text modifiers={[text.detail, foregroundStyle(tones[problem.tone])]}>{problem.label}</Text>
									</HStack>
								</ItemActions>
							)
						})
					)}
				</>
			)}
		</RemovableRow>
	)
}

function matchesOf(journeys: readonly Journey[], searched: string) {
	const needle = String.toLowerCase(String.trim(searched))
	return Array.filter(
		journeys,
		journey =>
			String.isEmpty(needle) ||
			String.includes(needle)(String.toLowerCase(`${headingOf(journey)} ${scheduleOf(journey)}`))
	)
}

function PastBookings(props: {
	expanded: boolean
	journeys: readonly Journey[]
	now: DateTime.Utc
	onExpandedChange: (expanded: boolean) => void
	onOpen: (id: Booking['id']) => void
}) {
	if (Array.isReadonlyArrayEmpty(props.journeys)) return undefined
	return (
		<Section title="Past" isExpanded={props.expanded} onIsExpandedChange={props.onExpandedChange}>
			{Array.map(props.journeys, journey => (
				<BookingRow
					key={Array.headNonEmpty(journey).id}
					journey={journey}
					countdown={Countdown.cases.SameDay.make({})}
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
	const matches = matchesOf(journeysOf(bookings), props.searched)
	const current = Array.filter(
		matches,
		journey =>
			pipe(startOfJourney(journey), DateTime.subtractDuration(Duration.hours(6)), DateTime.isLessThanOrEqualTo(now)) &&
			pipe(endOfJourney(journey), DateTime.addDuration(HOUR), DateTime.isGreaterThanOrEqualTo(now))
	)
	const ahead = Array.filter(matches, journey =>
		pipe(startOfJourney(journey), DateTime.subtractDuration(Duration.hours(6)), DateTime.isGreaterThan(now))
	)
	const past = Array.reverse(
		Array.filter(
			matches,
			journey =>
				pipe(endOfJourney(journey), DateTime.addDuration(HOUR), DateTime.isLessThan(now)) &&
				DateTime.isGreaterThan(endOfJourney(journey), DateTime.subtractDuration(now, Duration.days(30)))
		)
	)
	function daysOf(journey: Journey) {
		return daysUntil(startOfJourney(journey), now, zoneOf(journey))
	}
	// One root: a SwiftUI modifier on several sibling views applies to each, so the dialog and the toolbar would repeat.
	return (
		<VStack spacing={0} modifiers={[frame({maxHeight: Infinity})]}>
			{adding && (
				<ItemGroupSkeleton
					rows={1}
					descriptionLines={2}
					media={
						<ItemMedia>
							<Gutter countdown={Countdown.cases.Days.make({days: 2})} />
						</ItemMedia>
					}
				/>
			)}
			{Array.isReadonlyArrayEmpty(bookings) && !adding && (
				<Empty>
					<EmptyContent>
						<Button
							size="lg"
							systemImage="doc.text"
							onPress={() => paste(clipboard.events.Returned())}
							modifiers={[tint(primary)]}
						>
							Paste Booking
						</Button>
					</EmptyContent>
				</Empty>
			)}
			{Array.isReadonlyArrayNonEmpty(bookings) && (
				// The no-match state sits over the list, centred on the screen, as SwiftUI's own apps show it.
				<Overlay>
					<ItemGroup modifiers={[tint(primary)]}>
						{Array.isReadonlyArrayNonEmpty(current) && (
							<Section title="Now">
								{Array.map(current, journey => (
									<BookingRow
										key={Array.headNonEmpty(journey).id}
										journey={journey}
										countdown={Countdown.cases.Now.make({})}
										now={now}
										onOpen={props.onOpen}
									/>
								))}
							</Section>
						)}
						{Array.isReadonlyArrayNonEmpty(ahead) && (
							<Section title="Upcoming">
								{Array.map(ahead, (journey, position) => (
									<BookingRow
										key={Array.headNonEmpty(journey).id}
										journey={journey}
										countdown={pipe(
											ahead,
											Array.get(position - 1),
											Option.match({
												onNone: () => Countdown.cases.Days.make({days: daysOf(journey)}),
												onSome: before =>
													Boolean.match(daysOf(before) === daysOf(journey), {
														onFalse: () => Countdown.cases.Days.make({days: daysOf(journey)}),
														onTrue: () => Countdown.cases.SameDay.make({})
													})
											})
										)}
										now={now}
										onOpen={props.onOpen}
									/>
								))}
							</Section>
						)}
						{Array.isReadonlyArrayNonEmpty(matches) &&
							Array.isReadonlyArrayEmpty(current) &&
							Array.isReadonlyArrayEmpty(ahead) && (
								<Section>
									<Empty>
										<EmptyMedia>
											<Image systemName="ticket" modifiers={[accessibilityLabel('Nothing coming up')]} />
										</EmptyMedia>
									</Empty>
								</Section>
							)}
						<PastBookings
							journeys={past}
							expanded={pastOpen}
							now={now}
							onExpandedChange={setPastOpen}
							onOpen={props.onOpen}
						/>
					</ItemGroup>
					{Array.isReadonlyArrayEmpty(matches) && (
						<Overlay.Content>
							<Empty>
								<EmptyMedia>
									<Image systemName="magnifyingglass" modifiers={[accessibilityLabel('No bookings match')]} />
								</EmptyMedia>
							</Empty>
						</Overlay.Content>
					)}
				</Overlay>
			)}
		</VStack>
	)
}

// Native navigation and clipboard/account controls do not wait for the bookings stream; the bar marks bookings that stopped updating.
export function HomeRoute(props: {onOpen: (id: Booking['id']) => void}) {
	const [searched, setSearched] = useState('')
	const loaded = useAtomValue(bookingsAtom)
	return (
		<ListToolbar
			title="Trips"
			session={session}
			onSearch={setSearched}
			problem={Option.liftPredicate(
				<Problem label="Out of date" onRetry={useAtomRefresh(bookingsAtom)} />,
				() => AsyncResult.isFailure(loaded) && Option.isNone(blockingFailure(loaded))
			)}
		>
			<PasteSheet clipboard={clipboard}>
				<Suspense
					fallback={
						<ItemGroupSkeleton
							rows={10}
							descriptionLines={2}
							media={
								<ItemMedia>
									<Gutter countdown={Countdown.cases.Days.make({days: 2})} />
								</ItemMedia>
							}
						/>
					}
				>
					<Bookings onOpen={props.onOpen} searched={searched} />
				</Suspense>
			</PasteSheet>
		</ListToolbar>
	)
}
