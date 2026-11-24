import {useAtom, useAtomMount, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Duration, Function, Option, Schema, String, pipe} from 'effect'

import {Button as NativeButton, HStack, Image, Section, Text, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	accessibilityValue,
	buttonStyle,
	contentShape,
	fixedSize,
	font,
	foregroundStyle,
	frame,
	imageScale,
	shapes,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'

import {ItemGroupSkeleton} from '@deslop/components-mobile/blocks/item-group-skeleton'
import {ListToolbar} from '@deslop/components-mobile/blocks/list-toolbar'
import {FailureContent} from '@deslop/components-mobile/blocks/loaded'
import {Problem} from '@deslop/components-mobile/blocks/problem'
import {RemovableRow} from '@deslop/components-mobile/blocks/removable-row'
import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Button} from '@deslop/components-mobile/ui/button'
import {Empty, EmptyContent, EmptyMedia} from '@deslop/components-mobile/ui/empty'
import {ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle} from '@deslop/components-mobile/ui/item'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {problemSinceAtom} from '@deslop/runtime/client/problem'

import {flightsAtom, clipboard, nowAtom, removal} from '#lib/flights.ts'
import {primary, session} from '#lib/session.ts'
import {daysUntil, problemOf, statusOf, tones} from '#lib/status.ts'
import {arrivalClockOf, arrivalOf, clockAt, departureOf, HOUR, titleOf} from '#services/flights/lib/utils.ts'
import type {FlightId, Flight} from '#services/flights/schema.ts'

function headingOf(flight: Flight) {
	return `${Option.getOrElse(flight.from.city, () => flight.from.name)} to ${Option.getOrElse(flight.to.city, () => flight.to.name)}`
}

function scheduleOf(flight: Flight) {
	const departs = clockAt(departureOf(flight), flight.from.timeZone)
	return `${titleOf(flight)} · ${Option.getOrElse(flight.from.code, () => flight.from.name)} ${departs} → ${Option.getOrElse(flight.to.code, () => flight.to.name)} ${arrivalClockOf(flight)}`
}

// The schedule and the gate it leaves from, each shown once.
function lineOf(flight: Flight, status: ReturnType<typeof statusOf>) {
	const where = Option.getOrElse(status.where, Function.constant(''))
	return pipe([scheduleOf(flight), where], Array.filter(String.isNonEmpty), Array.join(' · '))
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

function FlightRow(props: {flight: Flight; countdown: Countdown; now: DateTime.Utc; onOpen: (id: FlightId) => void}) {
	const status = statusOf(props.flight, props.now)
	return (
		<RemovableRow alignment="top" id={props.flight.id} removal={removal} onOpen={() => props.onOpen(props.flight.id)}>
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
							{headingOf(props.flight)}
						</ItemTitle>
						<Text modifiers={[text.data, foregroundStyle(colors.mutedForeground)]}>{lineOf(props.flight, status)}</Text>
					</ItemContent>
					{pipe(
						problemOf(props.flight, status, props.now),
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

function PastFlights(props: {
	expanded: boolean
	flights: readonly Flight[]
	now: DateTime.Utc
	onExpandedChange: (expanded: boolean) => void
	onOpen: (id: FlightId) => void
}) {
	if (Array.isReadonlyArrayEmpty(props.flights)) return undefined
	// A plain list draws no toggle on a collapsible section, only the sidebar style does, so the header is the toggle.
	return (
		<Section
			header={
				<NativeButton
					onPress={() => props.onExpandedChange(!props.expanded)}
					modifiers={[
						buttonStyle('plain'),
						accessibilityValue(
							Boolean.match(props.expanded, {
								onFalse: Function.constant('Collapsed'),
								onTrue: Function.constant('Expanded')
							})
						)
					]}
				>
					{/* The whole header row answers the tap, not only its words. */}
					<HStack
						spacing={space[1]}
						modifiers={[
							foregroundStyle(colors.mutedForeground),
							frame({alignment: 'leading', maxWidth: Infinity}),
							contentShape(shapes.rectangle())
						]}
					>
						<Text>Past</Text>
						<Image
							systemName={Boolean.match(props.expanded, {
								onFalse: Function.constant('chevron.right'),
								onTrue: Function.constant('chevron.down')
							})}
							modifiers={[imageScale('small')]}
						/>
					</HStack>
				</NativeButton>
			}
		>
			{props.expanded &&
				Array.map(props.flights, flight => (
					<FlightRow
						key={flight.id}
						flight={flight}
						countdown={Countdown.cases.SameDay.make({})}
						now={props.now}
						onOpen={props.onOpen}
					/>
				))}
		</Section>
	)
}

// Every copy of the list shows Past the same way, so the copy below the board in laptop posture keeps it open when the phone lies flat.
const pastOpenAtom = Atom.make(false)

function Flights(props: {onOpen: (id: FlightId) => void}) {
	const loaded = useAtomSuspense(flightsAtom, {includeFailure: true})
	const refresh = useAtomRefresh(flightsAtom)
	const paste = useAtomSet(clipboard.atom.send)
	const [pastOpen, setPastOpen] = useAtom(pastOpenAtom)

	const now = useAtomValue(nowAtom)
	const adding = pipe(
		useMachineResult(AtomMachine.select(clipboard.atom, 'Answering')),
		AsyncResult.value,
		Option.flatten,
		Option.exists(current => current.save)
	)
	const blocking = Option.getOrUndefined(blockingFailure(loaded))
	if (blocking !== undefined) return <FailureContent cause={blocking} onRetry={refresh} />
	const flights = AsyncResult.getOrElse(loaded, () => [])
	const current = Array.filter(
		flights,
		flight =>
			pipe(departureOf(flight), DateTime.subtractDuration(Duration.hours(6)), DateTime.isLessThanOrEqualTo(now)) &&
			pipe(arrivalOf(flight), DateTime.addDuration(HOUR), DateTime.isGreaterThanOrEqualTo(now))
	)
	const ahead = Array.filter(flights, flight =>
		pipe(departureOf(flight), DateTime.subtractDuration(Duration.hours(6)), DateTime.isGreaterThan(now))
	)
	const past = Array.reverse(
		Array.filter(
			flights,
			flight =>
				pipe(arrivalOf(flight), DateTime.addDuration(HOUR), DateTime.isLessThan(now)) &&
				DateTime.isGreaterThan(arrivalOf(flight), DateTime.subtractDuration(now, Duration.days(30)))
		)
	)
	function daysOf(flight: Flight) {
		return daysUntil(departureOf(flight), now, flight.from.timeZone)
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
			{Array.isReadonlyArrayEmpty(flights) && !adding && (
				<Empty>
					<EmptyContent>
						<Button
							size="lg"
							systemImage="doc.text"
							onPress={() => paste(clipboard.events.Returned())}
							modifiers={[tint(primary)]}
						>
							Paste Ticket
						</Button>
					</EmptyContent>
				</Empty>
			)}
			{Array.isReadonlyArrayNonEmpty(flights) && (
				<ItemGroup modifiers={[tint(primary)]}>
					{Array.isReadonlyArrayNonEmpty(current) && (
						<Section title="Now">
							{Array.map(current, flight => (
								<FlightRow
									key={flight.id}
									flight={flight}
									countdown={Countdown.cases.Now.make({})}
									now={now}
									onOpen={props.onOpen}
								/>
							))}
						</Section>
					)}
					{Array.isReadonlyArrayNonEmpty(ahead) && (
						<Section title="Upcoming">
							{Array.map(ahead, (flight, position) => (
								<FlightRow
									key={flight.id}
									flight={flight}
									countdown={pipe(
										ahead,
										Array.get(position - 1),
										Option.match({
											onNone: () => Countdown.cases.Days.make({days: daysOf(flight)}),
											onSome: before =>
												Boolean.match(daysOf(before) === daysOf(flight), {
													onFalse: () => Countdown.cases.Days.make({days: daysOf(flight)}),
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
					{Array.isReadonlyArrayEmpty(current) && Array.isReadonlyArrayEmpty(ahead) && (
						<Section>
							<Empty>
								<EmptyMedia>
									<Image systemName="ticket" modifiers={[accessibilityLabel('Nothing coming up')]} />
								</EmptyMedia>
							</Empty>
						</Section>
					)}
					<PastFlights
						flights={past}
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

// Native navigation and clipboard/account controls do not wait for the flights stream; the bar marks flights that stopped updating.
export function HomeRoute(props: {onOpen: (id: FlightId) => void}) {
	const loaded = useAtomValue(flightsAtom)
	useAtomMount(problemSinceAtom(flightsAtom))
	return (
		<ListToolbar
			title="Trips"
			session={session}
			problem={Option.liftPredicate(
				<Problem source={flightsAtom} label="Out of date" onRetry={useAtomRefresh(flightsAtom)} />,
				() => AsyncResult.isFailure(loaded) && Option.isNone(blockingFailure(loaded))
			)}
		>
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
				<Flights onOpen={props.onOpen} />
			</Suspense>
		</ListToolbar>
	)
}
