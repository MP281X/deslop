import {RegistryContext, useAtom, useAtomRefresh, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Number, Option, Order, Predicate, Record, Schema, String, Struct} from 'effect'

import {
	ArrowUpRightIcon,
	BroadcastIcon,
	CaretDownIcon,
	ChatsIcon,
	CheckIcon,
	CoinsIcon,
	CrosshairIcon,
	EyeIcon,
	RobotIcon,
	SquaresFourIcon,
	WarningCircleIcon,
	WarningIcon,
	WifiSlashIcon,
	XIcon
} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {PointerEvent, ReactNode, RefObject, UIEvent, WheelEvent} from 'react'
import {createContext, useContext, useEffect, useRef, useState} from 'react'

import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {Problem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Alert, AlertAction, AlertDescription, AlertTitle} from '@deslop/components-web/ui/alert'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia} from '@deslop/components-web/ui/empty'
import {Popover, PopoverContent, PopoverTitle, PopoverTrigger} from '@deslop/components-web/ui/popover'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {cn} from '@deslop/components-web/utils'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {createCast} from './-cast.ts'
import type {Cast} from './-cast.ts'
import type {Inspected} from './-chunks.worker.ts'
import {
	actorName,
	actorKind,
	decisionDetails,
	displayEvents,
	entityField,
	eventSubject,
	eventSummary,
	eventText,
	fieldName,
	recordData,
	requestMembers,
	requestContinuation,
	requestMemory,
	requestState,
	roundSummary,
	textParts,
	sameObservationGroup
} from './-events.ts'
import {TeamIcon} from './-icons.tsx'
import {createRenderer} from './-renderer.ts'
import type {Renderer} from './-renderer.ts'
import {spendOf} from './-spend.ts'

import {
	EMPTY,
	configurationAtom,
	feedAtom,
	cursorAtom,
	followAtom,
	hoverAtom,
	historyAtom,
	hudAtom,
	loadingAtom,
	threadFeedAtom,
	runStateAtom,
	seedAtom,
	Search,
	sourceAtom,
	usageAtom,
	viewAtom
} from '#lib/utils.ts'
import type {Follow, Source, View} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import {TEAMS, TICK_HZ} from '#services/game/lib/utils.ts'
import type {
	BuildingView,
	Entry,
	Experience,
	LocalDecision,
	TeamView,
	UnitView,
	UsageLedger
} from '#services/game/schema.ts'
import {UnitKind} from '#services/game/schema.ts'
import {tileOf} from '#services/world/lib/utils.ts'

const MAP_SURFACE =
	'border-border bg-popover/95 text-popover-foreground supports-backdrop-filter:bg-popover/85 border backdrop-blur-md'
const MAP_CONTROLS = 'border-border bg-background/95 text-foreground border backdrop-blur-md'
const ZOOM_STEP = 1.25
const groundAtom = Atom.make({at: Option.none<{x: number; z: number}>(), info: Option.none<Inspected>(), x: 0, y: 0})
const chunksAtom = Atom.make(true)
const route = getRouteApi('/(home)/')
const USAGE_MODE: UsageMode = Boolean.match(import.meta.env.DEV, {
	onFalse: () => 'production',
	onTrue: () => 'development'
})
type Key = 'down' | 'in' | 'leave' | 'left' | 'next' | 'out' | 'previous' | 'right' | 'up'
type Inspection = {actor: Option.Option<number>; entry: Option.Option<Experience>; scoped: boolean}
type UsageMode = 'development' | 'production'
type WorldState = {dot: 'error' | 'live' | 'off' | 'quiet'; label: string; waiting: boolean}

// The spectator's own state, not the simulation's: a frozen view, a failed or absent stream, then the authoritative run.
function worldState(live: boolean, failed: boolean, pending: boolean, running: boolean) {
	if (!live) return {dot: 'quiet', label: 'History', waiting: false} satisfies WorldState
	if (failed) return {dot: 'error', label: 'Offline', waiting: false} satisfies WorldState
	if (pending) return {dot: 'live', label: 'Connecting', waiting: true} satisfies WorldState
	if (running) return {dot: 'live', label: 'Live', waiting: false} satisfies WorldState
	return {dot: 'off', label: 'Paused', waiting: false} satisfies WorldState
}

function percent(share: number) {
	return `${Number.round(Number.clamp(share, {maximum: 1, minimum: 0}) * 100, 0)}%`
}

function isUnit(kind: string) {
	return Array.some(UnitKind.literals, own => own === kind)
}

// A tick as the run's clock: hours, minutes and seconds since the world began.
function clockOf(tick: number) {
	const seconds = Math.floor(tick / TICK_HZ)
	const pad = String.padStart(2, '0')
	return String.replace(
		/^0:/u,
		''
	)(`${Math.floor(seconds / 3600)}:${pad(`${Math.floor(seconds / 60) % 60}`)}:${pad(`${seconds % 60}`)}`)
}

function teamColor(team: number) {
	return TEAMS[team]?.color ?? '#888888'
}

// Team colour is an identity, so it stays itself on the map and in swatches; running text mixes it toward the foreground to read on both appearances.
function teamTextColor(team: number) {
	return `color-mix(in oklch, ${teamColor(team)} 50%, var(--foreground))`
}

function teamName(team: number) {
	if (team === -1) return 'All models'
	return TEAMS[team]?.name ?? `Team ${team}`
}

// The URL for a team, or for every team at -1.
function teamSearch(team: number) {
	return Option.match(Option.liftPredicate(team, Number.isGreaterThanOrEqualTo(0)), {
		onNone: () => ({}),
		onSome: entry => ({team: entry})
	}) satisfies Search
}

// A team's units, in a stable order: by class, then by id.
function unitsOf(units: View['frame']['units'], team: number) {
	return Array.sortWith(
		Array.filter(units, unit => (team === -1 || unit.team === team) && isUnit(unit.kind)),
		(unit: UnitView) => unit.id,
		Number.Order
	)
}

// A pinch on a trackpad arrives as a wheel with ctrl held, in smaller deltas.
function wheelRate(pinch: boolean) {
	if (pinch) return 0.01
	return 0.0015
}

function preventMapWheel(event: Event) {
	event.preventDefault()
}

function symbolKey(key: string) {
	if (key === '+' || key === '=') return Option.some<Key>('in')
	if (key === '-' || key === '_') return Option.some<Key>('out')
	if (key === 'Escape') return Option.some<Key>('leave')
	return Option.none<Key>()
}

// What a key does: letters by their place on the keyboard, symbols by what they type, so both read the same on any layout.
function keyOf(event: KeyboardEvent) {
	if (event.metaKey || event.ctrlKey || event.altKey) return Option.none<Key>()
	if (event.code === 'BracketLeft') return Option.some<Key>('previous')
	if (event.code === 'BracketRight') return Option.some<Key>('next')
	if (event.code === 'ArrowLeft') return Option.some<Key>('left')
	if (event.code === 'ArrowRight') return Option.some<Key>('right')
	if (event.code === 'ArrowUp') return Option.some<Key>('up')
	if (event.code === 'ArrowDown') return Option.some<Key>('down')
	return symbolKey(event.key)
}

// Each model's portrait, painted by the cast as the models load.
const Portraits = createContext<{images: Record<string, string>; request: (kind: string) => void}>({
	images: {},
	request: () => undefined
})
const Membership = createContext<Record<string, {kind: string; team?: number; x?: number; z?: number}>>({})

const Navigation = createContext<{
	core: (team: number, tick: number) => void
	event: (entry: Experience) => void
	entity: (id: number, tick: number, fallback?: {x: number; z: number}) => void
	place: (x: number, z: number, tick: number) => void
	selected: Option.Option<number>
}>({
	core: () => undefined,
	entity: () => undefined,
	event: () => undefined,
	place: () => undefined,
	selected: Option.none()
})

function Portrait(props: {className?: string; kind: string}) {
	const portraits = useContext(Portraits)
	useEffect(() => portraits.request(props.kind), [portraits, props.kind])
	return Option.match(Record.get(portraits.images, props.kind), {
		onNone: () => <span aria-hidden="true" className={cn('bg-muted block flex-none', props.className)} />,
		onSome: source => (
			<img src={source} alt={props.kind} draggable={false} className={cn('block flex-none', props.className)} />
		)
	})
}

function EntityReference(props: {
	fallback?: {x: number; z: number}
	id: number
	kind?: string
	standalone?: boolean
	tick: number
}) {
	const navigate = useContext(Navigation)

	const member = useContext(Membership)[props.id]
	const kind = props.kind ?? member?.kind
	const name = Option.match(Option.fromUndefinedOr(kind), {
		onNone: () => `Recorded entity #${props.id}`,
		onSome: current => actorName(current, props.id)
	})
	const label = String.replace(` #${props.id}`, '')(name)
	return (
		// oxlint-disable-next-line @deslop/coding-standards/no-native-control -- A reference is inline text; Button's box would break the sentence.
		<button
			type="button"
			data-inline="true"
			title={name}
			className={cn(
				'text-foreground hover:text-muted-foreground pointer-events-auto inline-flex cursor-pointer items-center gap-1 align-middle underline decoration-current underline-offset-4',
				props.standalone === true && 'min-h-11'
			)}
			onClick={() =>
				navigate.entity(
					props.id,
					props.tick,
					props.fallback ??
						Option.getOrUndefined(
							Option.all({x: Option.fromUndefinedOr(member?.x), z: Option.fromUndefinedOr(member?.z)})
						)
				)
			}
		>
			{kind !== undefined && <Portrait kind={kind} className="inline-block size-5" />}
			<span>
				{label}
				{label !== name && <span className="font-mono"> #{props.id}</span>}
			</span>
		</button>
	)
}

function References(props: {standalone?: boolean; text: string; tick: number}) {
	const navigate = useContext(Navigation)
	return (
		<>
			{Array.map(
				String.split(/(#-?\d+(?: \(\w+\))?|\(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\))/u)(props.text),
				(part, index) => {
					if (String.startsWith('#')(part)) {
						const match = Option.getOrThrow(String.match(/^#(-?\d+)(?: \((\w+)\))?$/u)(part))
						return (
							<EntityReference
								key={index}
								id={Option.getOrThrow(Number.parse(match[1] ?? ''))}
								kind={match[2]}
								tick={props.tick}
							/>
						)
					}
					return Option.match(String.match(/^\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/u)(part), {
						onNone: () => <span key={index}>{part}</span>,
						onSome: found => (
							// oxlint-disable-next-line @deslop/coding-standards/no-native-control -- A reference is inline text; Button's box would break the sentence.
							<button
								type="button"
								key={index}
								data-inline="true"
								className={cn(
									'text-foreground hover:text-muted-foreground pointer-events-auto cursor-pointer underline decoration-current underline-offset-4',
									props.standalone === true && 'inline-flex min-h-11 items-center'
								)}
								onClick={() =>
									navigate.place(
										Option.getOrElse(Number.parse(found[1] ?? ''), () => 0),
										Option.getOrElse(Number.parse(found[2] ?? ''), () => 0),
										props.tick
									)
								}
							>
								this location
							</button>
						)
					})
				}
			)}
		</>
	)
}

function Swatch(props: {className?: string; team: number}) {
	return (
		<i
			aria-hidden="true"
			className={cn(
				'outline-border inline-block size-2 flex-none bg-(--team) outline-1 -outline-offset-1',
				props.className
			)}
			style={{'--team': teamColor(props.team)}}
		/>
	)
}

function Pips(props: {value: number}) {
	return (
		<span className="grid h-1 grid-cols-5 gap-px" aria-label={`${percent(props.value)} health`}>
			{Array.map(Array.range(0, 4), index => (
				<i key={index} className="bg-input relative">
					<i
						className="bg-foreground absolute inset-y-0 left-0 w-(--fill)"
						style={{'--fill': percent(props.value * 5 - index)}}
					/>
				</i>
			))}
		</span>
	)
}

function Meter(props: {children: ReactNode; value: string}) {
	return (
		<span className="mt-2 flex items-center gap-2">
			<span className="flex-1">{props.children}</span>
			<span className="text-muted-foreground min-w-12 text-right font-mono text-xs whitespace-nowrap tabular-nums">
				{props.value}
			</span>
		</span>
	)
}

function Panel(props: {children: ReactNode; className?: string; label?: string}) {
	return (
		<section aria-label={props.label} className={cn(MAP_SURFACE, 'absolute', props.className)}>
			{props.children}
		</section>
	)
}

function doingOf(unit: UnitView) {
	return `${unit.doing}${Option.getOrElse(
		Option.map(
			Option.filter(Option.fromUndefinedOr(unit.cargo), () => unit.load > 0),
			cargo => `, ${percent(unit.load)} ${String.replaceAll('_', ' ')(cargo)}`
		),
		() => ''
	)}`
}

// A notice a team's model read: a message from another team in a box of its colour, the rest as plain lines.
function Notice(props: {text: string; tick: number}) {
	return Option.match(String.match(/^Message from team (\d+) \([^)]*\): ([\s\S]*)$/u)(props.text), {
		onNone: () => (
			<li className="text-muted-foreground">
				<References text={props.text} tick={props.tick} />
			</li>
		),
		onSome: found => {
			const team = Option.getOrElse(Number.parse(found[1] ?? ''), () => 0)
			return (
				<li
					className="bg-muted/40 border-l-2 border-(--team) px-3 py-2 leading-relaxed"
					style={{'--team': teamColor(team)}}
				>
					<span
						className="mb-1 flex items-center gap-1.5 text-xs text-(--team-text)"
						style={{'--team-text': teamTextColor(team)}}
					>
						<Swatch team={team} />
						{teamName(team)}
					</span>
					<References text={found[2] ?? ''} tick={props.tick} />
				</li>
			)
		}
	})
}

function argumentsOf(command: Entry['commands'][number]['command']) {
	if (command._tag === 'Order') {
		return {
			...Struct.omit(command, ['_tag', 'order']),
			objective: command.order._tag,
			...Struct.omit(command.order, ['_tag'])
		}
	}
	return Struct.omit(command, ['_tag'])
}

function commandPlace(command: Entry['commands'][number]['command']) {
	if (command._tag === 'Build') return Option.some({x: command.x, z: command.z})
	if (
		command._tag === 'Order' &&
		Predicate.hasProperty(command.order, 'x') &&
		Predicate.hasProperty(command.order, 'z')
	) {
		return Option.some({x: command.order.x, z: command.order.z})
	}
	return Option.none<{x: number; z: number}>()
}

type DataRecord = typeof DataRecord.Type
const DataRecord = Schema.Record(Schema.String, Schema.Unknown)

function RecordIdentity(props: {data: ReturnType<typeof recordData>}) {
	if (props.data.reference) return <span className="text-muted-foreground">Earlier recorded experience</span>
	return (
		<>
			{Option.getOrUndefined(Option.map(props.data.identity, identity => <EntityReference {...identity} />))}
			{props.data.anchor === undefined &&
				Option.getOrUndefined(
					Option.map(props.data.at, at => <References text={`(${at.x}, ${at.z})`} tick={at.tick} />)
				)}
		</>
	)
}

function DataValue(props: {field?: string; tick: number; value: unknown}) {
	if (Predicate.isNullish(props.value)) return <span className="text-muted-foreground">—</span>
	if (Array.isArray(props.value)) {
		if (Array.isReadonlyArrayEmpty(props.value)) return <span className="text-muted-foreground">None</span>
		return (
			<ul className="marker:text-muted-foreground list-disc space-y-1 pl-4">
				{Array.map(props.value, (value, index) => (
					<li key={index}>
						<DataValue
							value={value}
							tick={props.tick}
							field={Boolean.match(props.field === 'units' || props.field === 'facts', {
								onFalse: () => props.field,
								onTrue: () => 'target'
							})}
						/>
					</li>
				))}
			</ul>
		)
	}
	if (Schema.is(DataRecord)(props.value)) {
		const data = recordData(props.value, props.tick)
		return (
			<>
				<RecordIdentity data={data} />
				<dl className="grid grid-cols-3 gap-x-3 gap-y-1">
					{Array.map(data.fields, field => (
						<div key={field[0]} className="contents">
							<dt
								className={cn('text-muted-foreground font-mono text-xs', Predicate.isObject(field[1]) && 'col-span-3')}
							>
								{fieldName(field[0])}
							</dt>
							<dd
								className={cn(
									'col-span-2 min-w-0 text-xs leading-relaxed break-words',
									Predicate.isObject(field[1]) && 'col-span-3'
								)}
							>
								<DataValue
									field={field[0]}
									value={field[1]}
									tick={Option.getOrElse(
										Option.map(data.at, at => at.tick),
										() => props.tick
									)}
								/>
								{field[0] === data.anchor &&
									Option.getOrUndefined(
										Option.map(data.at, at => (
											<span>
												{' '}
												at <References text={`(${at.x}, ${at.z})`} tick={at.tick} />
											</span>
										))
									)}
							</dd>
						</div>
					))}
				</dl>
			</>
		)
	}
	if (Predicate.isString(props.value)) {
		return Array.map(textParts(props.value), (part, index) => {
			if (part.kind === 'text') {
				return (
					<span key={index} className="whitespace-pre-wrap">
						<References text={part.text} tick={props.tick} />
					</span>
				)
			}
			return <DataValue key={index} value={part.value} tick={props.tick} />
		})
	}
	if (Predicate.isNumber(props.value)) {
		if (props.field === 'tick') return <time className="font-mono tabular-nums">{clockOf(props.value)}</time>
		if (props.field === 'health') return <span className="font-mono tabular-nums">{percent(props.value)}</span>
		if (entityField(props.field ?? '')) {
			return <References text={`#${props.value}`} tick={props.tick} />
		}
		return <span className="font-mono tabular-nums">{props.value.toLocaleString('en')}</span>
	}
	return <span>{Boolean.match(props.value === true, {onFalse: () => 'No', onTrue: () => 'Yes'})}</span>
}

function StructuredText(props: {text: string; tick: number}) {
	return (
		<div className="space-y-2">
			{Array.map(Array.filter(String.split('\n')(props.text), String.isNonEmpty), (line, index) => (
				<div key={index}>
					<DataValue value={line} tick={props.tick} />
				</div>
			))}
		</div>
	)
}

function RecordDetails(props: {children: ReactNode; contentClassName?: string; title: ReactNode; compact?: boolean}) {
	return (
		<Collapsible className={cn(props.compact !== true && 'relative mt-1')}>
			<CollapsibleTrigger
				render={
					<Button
						variant="ghost"
						size={Boolean.match(props.compact === true, {onFalse: () => 'sm' as const, onTrue: () => 'icon' as const})}
						className={Boolean.match(props.compact === true, {
							onFalse: () => 'w-full max-sm:h-11',
							onTrue: () => 'absolute top-0 right-0 z-10 size-11'
						})}
					/>
				}
			>
				<span className={cn('flex w-full min-w-0 items-center gap-1.5', props.compact === true && 'justify-center')}>
					<CaretDownIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-panel-open/button:rotate-180" />
					<span className={cn('min-w-0 truncate', props.compact === true && 'sr-only')}>{props.title}</span>
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div
					className={cn(
						'text-xs',
						Boolean.match(props.compact === true, {
							onFalse: () => 'border-border mt-1 ml-1 space-y-3 border-l py-2 pr-1 pl-3',
							onTrue: () => 'border-border mt-1 space-y-3 border-t pt-3'
						}),
						props.contentClassName
					)}
				>
					{props.children}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
}

function FieldLabel(props: {children: ReactNode}) {
	return <p className="text-muted-foreground tracking-label mb-1 text-xs font-semibold uppercase">{props.children}</p>
}

function DecisionRequest(props: {request: LocalDecision}) {
	const members = useContext(Membership)
	const state: Record<string, unknown> = Option.getOrElse(requestState(props.request), () => ({}))
	const memory = requestMemory(props.request)
	const continuation = requestContinuation(props.request)
	const conditions = Record.filter(
		state,
		(_value, key) => !Array.contains(['self', 'facts', 'recent', 'guidance'], key)
	)
	return (
		<Membership value={{...members, ...requestMembers(props.request, members)}}>
			<div className="space-y-4">
				{Record.isEmptyRecord(state) && (
					<RecordDetails title="Recorded state">
						<StructuredText text={props.request.state} tick={props.request.tick} />
					</RecordDetails>
				)}
				{Record.has(state, 'self') && (
					<div>
						<FieldLabel>At decision</FieldLabel>
						<p className="text-muted-foreground mb-2 font-mono text-xs tabular-nums">{clockOf(props.request.tick)}</p>
						<DataValue
							value={Option.match(Schema.decodeUnknownOption(DataRecord)(state['self']), {
								onNone: () => state['self'],
								onSome: self => Struct.omit(self, ['id', 'kind'])
							})}
							tick={props.request.tick}
						/>
					</div>
				)}
				{Predicate.isString(state['guidance']) && String.isNonEmpty(state['guidance']) && (
					<div>
						<FieldLabel>Guidance</FieldLabel>
						<StructuredText text={state['guidance']} tick={props.request.tick} />
					</div>
				)}
				{Record.has(state, 'facts') && (
					<RecordDetails title="Remembered world">
						<DataValue value={state['facts']} tick={props.request.tick} />
					</RecordDetails>
				)}
				{!Record.isEmptyRecord(conditions) && (
					<RecordDetails title="Conditions">
						<DataValue value={conditions} tick={props.request.tick} />
					</RecordDetails>
				)}
				<div>
					<FieldLabel>Available choices</FieldLabel>
					<ul className="space-y-2">
						{Array.map(Record.toEntries(props.request.choices), choice => (
							<li key={choice[0]} className="flex gap-2">
								<span className="text-muted-foreground mt-0.5 shrink-0 font-mono text-xs">{choice[0]}</span>
								<span className="min-w-0 flex-1 leading-relaxed">
									<References text={choice[1]} tick={props.request.tick} />
								</span>
							</li>
						))}
					</ul>
				</div>
				{props.request.experience !== undefined && (
					<RecordDetails title="Recent experience">
						<DataValue value={props.request.experience} tick={props.request.tick} />
					</RecordDetails>
				)}
				{Array.isReadonlyArrayNonEmpty(memory) && (
					<RecordDetails title="Other recorded memory">
						<DataValue value={memory} tick={props.request.tick} />
					</RecordDetails>
				)}
				{String.isNonEmpty(continuation) && (
					<RecordDetails title="Earlier conversation">
						<StructuredText text={continuation} tick={props.request.tick} />
					</RecordDetails>
				)}
				{props.request.instructions !== undefined && (
					<RecordDetails title="Instructions">
						<StructuredText text={props.request.instructions} tick={props.request.tick} />
					</RecordDetails>
				)}
			</div>
		</Membership>
	)
}

function OriginalRequest(props: {text: string; tick: number}) {
	return Option.match(decisionDetails(props.text), {
		onNone: () => (
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">This record holds a request in an earlier format.</p>
				<RecordDetails title="Recorded request">
					<StructuredText text={props.text} tick={props.tick} />
				</RecordDetails>
			</div>
		),
		onSome: request => <DecisionRequest request={request} />
	})
}

// An event without a decision request repeats none of its thread message; it shows what was recorded around it.
function EventDetails(props: {entry: Experience}) {
	return (
		<div className="space-y-4">
			<dl className="grid grid-cols-3 gap-x-3 gap-y-1">
				<dt className="text-muted-foreground font-mono text-xs">Event</dt>
				<dd className="col-span-2 min-w-0 text-xs">
					<Badge variant="secondary">{props.entry.kind}</Badge>{' '}
					<span className="text-muted-foreground">recorded event</span>
				</dd>
				{props.entry.subject !== undefined && (
					<>
						<dt className="text-muted-foreground font-mono text-xs">Subject</dt>
						<dd className="col-span-2 min-w-0 text-xs">
							<EntityReference id={props.entry.subject} standalone tick={props.entry.tick} />
						</dd>
					</>
				)}
				<dt className="text-muted-foreground font-mono text-xs">Place</dt>
				<dd className="col-span-2 min-w-0 text-xs">
					<References standalone text={`(${props.entry.x}, ${props.entry.z})`} tick={props.entry.tick} />
				</dd>
			</dl>
			{/* The complete record is offered only when it adds words the thread row did not already show. */}
			{Boolean.match(String.trim(eventText(props.entry)) === String.trim(eventSummary(props.entry)), {
				onFalse: () => (
					<RecordDetails title="Complete record">
						<StructuredText text={eventText(props.entry)} tick={props.entry.tick} />
					</RecordDetails>
				),
				onTrue: () => null
			})}
		</div>
	)
}

function RequestDetails(props: {entry: Experience}) {
	if (props.entry.context === undefined) return <EventDetails entry={props.entry} />
	return <OriginalRequest text={props.entry.context} tick={props.entry.tick} />
}

function Outcome(props: {outcome: Entry['commands'][number]; tick: number}) {
	const navigate = useContext(Navigation)
	return (
		<li>
			<RecordDetails
				title={
					<span className="inline-flex items-center gap-1.5">
						{Boolean.match(props.outcome.ok, {
							onFalse: () => <XIcon className="text-destructive size-3 shrink-0" />,
							onTrue: () => <CheckIcon className="text-muted-foreground size-3 shrink-0" />
						})}
						<span className={cn('font-mono tracking-normal normal-case', !props.outcome.ok && 'text-destructive')}>
							{props.outcome.command._tag}
						</span>
					</span>
				}
			>
				<div>
					<FieldLabel>Arguments</FieldLabel>
					<DataValue value={argumentsOf(props.outcome.command)} tick={props.tick} />
				</div>
				{Option.getOrUndefined(
					Option.map(commandPlace(props.outcome.command), at => (
						<Button variant="link" size="xs" className="h-auto" onClick={() => navigate.place(at.x, at.z, props.tick)}>
							<span className="tracking-normal normal-case">{props.outcome.command._tag} here</span>
						</Button>
					))
				)}
				<div className="leading-relaxed break-words">
					<FieldLabel>Result</FieldLabel>
					<StructuredText text={props.outcome.text} tick={props.tick} />
				</div>
			</RecordDetails>
		</li>
	)
}
// One round of a team's thread: when, what it was told, what it thought and said, and what each command did.
function Round(props: {entry: Entry}) {
	const navigate = useContext(Navigation)
	const summary = roundSummary(props.entry)
	return (
		<li className="list-row relative py-3 [&:has(>[data-slot=collapsible][data-open])_[data-preview]]:hidden">
			<div className="relative flex items-start gap-3 px-4">
				<Button
					variant="ghost"
					className="absolute inset-0 z-0 size-full max-md:min-h-11"
					aria-label={`${teamName(props.entry.team)} Core at ${clockOf(props.entry.tick)}`}
					onClick={() => navigate.core(props.entry.team, props.entry.tick)}
				>
					<span className="sr-only">View this message in the world</span>
				</Button>
				<Portrait kind={`home:${props.entry.team}`} className="pointer-events-none relative size-8" />
				<div className="pointer-events-none relative min-w-0 flex-1 pr-11">
					<header className="flex items-baseline justify-between gap-2 text-xs">
						<span className="truncate text-(--team-text)" style={{'--team-text': teamTextColor(props.entry.team)}}>
							{teamName(props.entry.team)} Core
						</span>
						<time className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
							{clockOf(props.entry.tick)}
						</time>
					</header>
					{(props.entry.status !== 'done' || summary.failed > 0 || summary.unreadable > 0) && (
						<div className="mt-1 flex flex-wrap items-center gap-1.5">
							{props.entry.status !== 'done' && (
								<Badge
									variant={Boolean.match(props.entry.status === 'failed', {
										onFalse: () => 'secondary',
										onTrue: () => 'destructive'
									})}
								>
									{props.entry.status}
								</Badge>
							)}
							{summary.failed > 0 && (
								<Badge variant="destructive">
									<WarningIcon />
									{summary.failed} failed
								</Badge>
							)}
							{summary.unreadable > 0 && (
								<Badge variant="destructive">
									<WarningIcon />
									{summary.unreadable} unreadable
								</Badge>
							)}
						</div>
					)}
					{String.isNonEmpty(String.trim(props.entry.text)) && (
						<div data-preview className="line-clamp-2 leading-relaxed">
							<References text={summary.text} tick={props.entry.tick} />
						</div>
					)}
					<ArrowUpRightIcon aria-hidden="true" className="text-muted-foreground absolute right-0 bottom-0 size-3" />
				</div>
			</div>
			<RecordDetails compact title="Core details">
				<StructuredText text={props.entry.text} tick={props.entry.tick} />
				{Array.isReadonlyArrayNonEmpty(props.entry.notices) && (
					<RecordDetails title="Received updates">
						<ul className="space-y-1.5 py-2">
							{Array.map(props.entry.notices, (notice, index) => (
								<Notice key={index} text={notice} tick={props.entry.observed ?? props.entry.tick} />
							))}
						</ul>
					</RecordDetails>
				)}
				{Option.getOrUndefined(
					Option.map(Option.filter(Option.fromUndefinedOr(props.entry.reasoning), String.isNonEmpty), reasoning => (
						<RecordDetails title="Reasoning">
							<p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
								<References text={String.trim(reasoning)} tick={props.entry.tick} />
							</p>
						</RecordDetails>
					))
				)}
				{Array.isReadonlyArrayNonEmpty(props.entry.commands) && (
					<ul className="space-y-1">
						{Array.map(props.entry.commands, (outcome, index) => (
							<Outcome key={index} outcome={outcome} tick={props.entry.tick} />
						))}
					</ul>
				)}
				<RecordDetails title="Original observation · active request may be abbreviated">
					<div className="text-xs">
						<StructuredText text={props.entry.observation} tick={props.entry.observed ?? props.entry.tick} />
					</div>
				</RecordDetails>
			</RecordDetails>
		</li>
	)
}

function historyTeam(entry: Experience, members: Record<string, {kind: string; team?: number}>) {
	return entry.team ?? members[entry.actor]?.team
}

function EventRecord(props: {entry: Experience}) {
	const navigate = useContext(Navigation)
	const members = useContext(Membership)
	const team = historyTeam(props.entry, members)
	const kind = actorKind(props.entry, members)
	const selected = Option.contains(navigate.selected, props.entry.id)
	return (
		<li
			aria-current={selected}
			data-selected={selected}
			className={cn('list-row relative py-3', selected && 'bg-secondary')}
			style={{'--team': teamColor(team ?? -1)}}
		>
			{selected && <i aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-(--team)" />}
			<div className="relative flex items-start gap-3 px-4">
				<Button
					variant="ghost"
					className="absolute inset-0 z-0 size-full max-md:min-h-11"
					aria-label={`${Boolean.match(team !== undefined, {
						onFalse: () => '',
						onTrue: () => `${teamName(team ?? -1)} · `
					})}${actorName(kind, props.entry.actor)} · ${props.entry.kind} at ${clockOf(props.entry.tick)}`}
					onClick={() => navigate.event(props.entry)}
				>
					<span className="sr-only">View this event in the world</span>
				</Button>
				<Portrait
					kind={Boolean.match(kind === 'home' && team !== undefined, {
						onFalse: () => kind,
						onTrue: () => `home:${team}`
					})}
					className="pointer-events-none relative size-8"
				/>
				<div className="pointer-events-none relative min-w-0 flex-1 pr-6">
					<header className="flex items-baseline justify-between gap-2 text-xs">
						<span className="truncate">
							{team !== undefined && <span className="text-muted-foreground">{teamName(team)} · </span>}
							<span className="text-(--team-text)" style={{'--team-text': teamTextColor(team ?? -1)}}>
								{actorName(kind, props.entry.actor)}
							</span>
						</span>
						<time className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
							{clockOf(props.entry.tick)}
						</time>
					</header>
					<div className="line-clamp-2 leading-relaxed break-words">
						<References text={eventSummary(props.entry)} tick={props.entry.tick} />
					</div>
					<ArrowUpRightIcon aria-hidden="true" className="text-muted-foreground absolute right-0 bottom-0 size-3" />
				</div>
			</div>
		</li>
	)
}

function Observations(props: {entries: readonly Experience[]}) {
	return (
		<li className="list-row relative">
			<RecordDetails
				contentClassName="mt-0 ml-0 border-l-0 py-0 pl-0"
				title={
					<span className="inline-flex items-center gap-2">
						<EyeIcon className="size-3 shrink-0" />
						<span>{props.entries.length} observations</span>
						<time className="font-mono text-xs tabular-nums">{clockOf(props.entries[0]?.tick ?? 0)}</time>
					</span>
				}
			>
				<ul>
					{Array.map(props.entries, entry => (
						<EventRecord key={entry.id} entry={entry} />
					))}
				</ul>
			</RecordDetails>
		</li>
	)
}

// Rows shaped like an event: a portrait, an author line and a two-line summary.
function ThreadSkeleton(props: {label: string}) {
	return (
		<div role="status" aria-busy="true" aria-label={props.label} className="px-4">
			{Array.map(Array.range(0, 2), row => (
				<div key={row} aria-hidden="true" className="flex items-start gap-3 py-3">
					<Skeleton className="size-8 shrink-0" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<div className="flex items-center justify-between gap-3">
							<Skeleton className="h-3 w-24" />
							<Skeleton className="h-3 w-12" />
						</div>
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-2/3" />
					</div>
				</div>
			))}
		</div>
	)
}

// A pane keeps what loaded under a quiet problem; a blocking read failure offers a destructive retry; loading is a skeleton and nothing is an Empty.
function PanelState(props: {
	empty: boolean
	failed: string
	icon: ReactNode
	label: string
	nothing: string
	result: AsyncResult.AsyncResult<unknown, unknown>
	retry: () => void
}) {
	const failure = AsyncResult.isFailure(props.result)
	if (failure && props.empty) {
		return (
			<li className="p-4">
				<Alert variant="destructive">
					<WarningCircleIcon />
					<AlertTitle>{props.failed}</AlertTitle>
					<AlertDescription>The server did not answer. Nothing was lost; try the same view again.</AlertDescription>
					<AlertAction>
						<Button variant="destructive" size="sm" className="max-sm:h-11" onClick={props.retry}>
							Retry
						</Button>
					</AlertAction>
				</Alert>
			</li>
		)
	}
	if (!props.empty) {
		return Boolean.match(failure, {
			onFalse: () => null,
			onTrue: () => (
				<li className="flex items-center px-4 py-2">
					<Problem warning label={props.failed} reset={props.retry} />
				</li>
			)
		})
	}
	if (Option.isNone(AsyncResult.value(props.result))) {
		return (
			<li>
				<ThreadSkeleton label={props.label} />
			</li>
		)
	}
	return (
		<li>
			<Empty role="status" aria-label={props.label}>
				<EmptyHeader>
					<EmptyMedia variant="icon">{props.icon}</EmptyMedia>
					<h2 className="font-heading text-lg leading-snug tracking-tight">{props.nothing}</h2>
				</EmptyHeader>
			</Empty>
		</li>
	)
}

// Opening older pages freezes this page's upper cursor so incoming records cannot create a gap.
function ThreadPage(props: {
	before?: number
	team: number
	onEarlier: () => void
	onLatest: () => void
	onRead: () => void
}) {
	const members = useContext(Membership)
	const [expanded, setExpanded] = useState(() => Option.none<{before: number; upper: number}>())
	const before = Option.getOrElse(
		Option.map(expanded, page => page.upper),
		() => props.before ?? -1
	)
	const source = Boolean.match(props.before === undefined && Option.isNone(expanded), {
		onFalse: () => feedAtom(before),
		onTrue: () => threadFeedAtom
	})
	const result = useAtomValue(source)
	const retry = useAtomRefresh(source)
	const currentPage = Option.getOrElse(AsyncResult.value(result), () => ({before: -1, entries: []}))
	const entries = currentPage.entries
	const events = Record.fromEntries(
		Array.map(
			displayEvents(
				Array.flatMap(entries, entry => {
					if (entry.kind === 'event') return [entry.value]
					return []
				})
			),
			entry => [`${entry.id}`, entry] as const
		)
	)
	const groups = Array.match(
		Array.filter(entries, entry => {
			if (entry.kind === 'event' && !Record.has(events, `${entry.value.id}`)) return false
			if (props.team === -1) return true
			if (entry.kind === 'core') return entry.value.team === props.team
			return historyTeam(entry.value, members) === props.team
		}),
		{
			onEmpty: () => [],
			onNonEmpty: shown =>
				Array.groupWith(
					shown,
					(left, right) =>
						left.kind === 'event' && right.kind === 'event' && sameObservationGroup(left.value, right.value)
				)
		}
	)
	useEffect(() => {
		if (props.before === undefined) props.onRead()
	})
	return (
		<>
			{Option.match(expanded, {
				onNone: () =>
					Option.getOrUndefined(
						Option.map(
							Option.filter(Array.head(entries), () => currentPage.before >= 0),
							() => (
								<li className="list-row relative py-2">
									<Button
										variant="ghost"
										size="sm"
										className="w-full max-sm:h-11"
										onClick={() => {
											props.onEarlier()
											setExpanded(
												Option.some({
													before: currentPage.before,
													upper: Option.getOrThrow(Array.last(entries)).value.tick
												})
											)
										}}
									>
										<span className="w-full text-left">Earlier records</span>
									</Button>
								</li>
							)
						)
					),
				onSome: page => (
					<>
						{props.before === undefined && (
							<li className="list-row relative py-2">
								<Button
									variant="ghost"
									size="sm"
									className="w-full max-sm:h-11"
									onClick={() => {
										setExpanded(Option.none())
										props.onLatest()
									}}
								>
									<span className="w-full text-left">Latest records</span>
								</Button>
							</li>
						)}
						<ThreadPage
							before={page.before}
							team={props.team}
							onEarlier={props.onEarlier}
							onLatest={props.onLatest}
							onRead={props.onRead}
						/>
					</>
				)
			})}
			<PanelState
				result={result}
				empty={Array.isReadonlyArrayEmpty(groups)}
				failed="Decisions could not be read"
				icon={<ChatsIcon weight="light" className="size-5" />}
				label="Decisions"
				nothing="No decisions in this part of the recording"
				retry={retry}
			/>
			{Array.map(groups, group => {
				const entry = Option.getOrThrow(Array.head(group))
				if (entry.kind === 'core') {
					return <Round key={`core:${entry.value.team}:${entry.value.round}`} entry={entry.value} />
				}
				if (group.length > 1) {
					return (
						<Observations
							key={`observations:${entry.value.id}`}
							entries={Array.getSomes(
								Array.map(group, item => {
									if (item.kind === 'event') return Record.get(events, `${item.value.id}`)
									return Option.none()
								})
							)}
						/>
					)
				}
				return Option.getOrUndefined(
					Option.map(Record.get(events, `${entry.value.id}`), event => (
						<EventRecord key={`event:${event.id}`} entry={event} />
					))
				)
			})}
		</>
	)
}

// A thread keeps its reader pinned to the newest record until they page back or scroll away.
function usePinnedScroller(root: RefObject<HTMLDivElement | null>) {
	const pinned = useRef(true)
	function scrollToEnd() {
		const viewport = root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
		viewport?.scrollTo({top: viewport.scrollHeight})
	}
	return {
		pin: (value: boolean) => {
			pinned.current = value
		},
		read: () => {
			if (pinned.current) scrollToEnd()
		},
		track: (event: UIEvent<HTMLDivElement>) => {
			if (!(event.target instanceof HTMLElement)) return
			pinned.current = event.target.scrollHeight - event.target.scrollTop - event.target.clientHeight < 24
		}
	}
}

function Thread(props: {status?: TeamView['status']; team: number}) {
	const root = useRef<HTMLDivElement>(null)
	const scroller = usePinnedScroller(root)
	return (
		<div ref={root} className="min-h-0 flex-1">
			<ScrollArea className="size-full" onScrollCapture={scroller.track}>
				<ol className="pb-2 select-text">
					<ThreadPage
						team={props.team}
						onEarlier={() => scroller.pin(false)}
						onLatest={() => scroller.pin(true)}
						onRead={() => scroller.read()}
					/>
					{props.status === 'thinking' && (
						<li className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-xs">
							<Spinner className="size-3" />
							Thinking
						</li>
					)}
				</ol>
			</ScrollArea>
		</div>
	)
}

function HistoryGroup(props: {entries: readonly Experience[]}) {
	return (
		<li>
			<ul>
				{Array.map(displayEvents(props.entries), entry => (
					<EventRecord key={entry.id} entry={entry} />
				))}
			</ul>
		</li>
	)
}

function HistoryPage(props: {
	actor: number | 'all'
	before?: number
	onEarlier: () => void
	onLatest: () => void
	onRead: () => void
}) {
	const [expanded, setExpanded] = useState(() => Option.none<{before: number; upper: number}>())
	const source = historyAtom(
		`${props.actor}:${Option.getOrElse(
			Option.map(expanded, page => page.upper),
			() => props.before ?? 0
		)}`
	)
	const result = useAtomValue(source)
	const retry = useAtomRefresh(source)
	const entries = Option.getOrElse(AsyncResult.value(result), () => [])
	useEffect(() => {
		if (props.before === undefined) props.onRead()
	})
	return (
		<>
			{Option.match(expanded, {
				onNone: () =>
					Option.getOrUndefined(
						Option.map(
							Option.filter(Array.head(entries), () => entries.length === 100),
							first => (
								<li className="list-row relative py-2">
									<Button
										variant="ghost"
										size="sm"
										className="w-full max-sm:h-11"
										onClick={() => {
											props.onEarlier()
											setExpanded(Option.some({before: first.id, upper: Option.getOrThrow(Array.last(entries)).id + 1}))
										}}
									>
										<span className="w-full text-left">Earlier events</span>
									</Button>
								</li>
							)
						)
					),
				onSome: page => (
					<>
						{props.before === undefined && (
							<li className="list-row relative py-2">
								<Button
									variant="ghost"
									size="sm"
									className="w-full max-sm:h-11"
									onClick={() => {
										setExpanded(Option.none())
										props.onLatest()
									}}
								>
									<span className="w-full text-left">Latest events</span>
								</Button>
							</li>
						)}
						<HistoryPage
							actor={props.actor}
							before={page.before}
							onEarlier={props.onEarlier}
							onLatest={props.onLatest}
							onRead={props.onRead}
						/>
					</>
				)
			})}
			<PanelState
				result={result}
				empty={Array.isReadonlyArrayEmpty(entries)}
				failed="History could not be read"
				icon={<EyeIcon weight="light" className="size-5" />}
				label="History"
				nothing="No recording here yet"
				retry={retry}
			/>
			{Array.map(Record.values(Array.groupBy(entries, entry => `${entry.actor}:${entry.tick}`)), entriesInTick => (
				<HistoryGroup key={Option.getOrThrow(Array.head(entriesInTick)).id} entries={entriesInTick} />
			))}
		</>
	)
}

function Chronicle(props: {actor: number}) {
	const root = useRef<HTMLDivElement>(null)
	const scroller = usePinnedScroller(root)
	return (
		<div ref={root} role="region" aria-label="Private individual history" className="min-h-0 flex-1">
			<ScrollArea className="size-full" onScrollCapture={scroller.track}>
				<ol className="pb-2 select-text">
					<HistoryPage
						actor={props.actor}
						onEarlier={() => scroller.pin(false)}
						onLatest={() => scroller.pin(true)}
						onRead={() => scroller.read()}
					/>
				</ol>
			</ScrollArea>
		</div>
	)
}

// State at the selected time, when there is no recorded decision input to inspect.
function Followed(props: {unit: UnitView}) {
	return (
		<div className="flex flex-none items-center gap-3 pb-3">
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-1.5 first-letter:uppercase">{doingOf(props.unit)}</p>
				<Meter value={percent(props.unit.health)}>
					<Pips value={props.unit.health} />
				</Meter>
			</div>
		</div>
	)
}

function Sidebar(props: {close: () => void; clear: () => void; selection: Inspection; source: Source; view: View}) {
	const filter = route.useSearch({select: search => search.team ?? -1})
	const members = useContext(Membership)
	const selected = Option.getOrUndefined(props.selection.entry)
	const actor = Option.getOrUndefined(props.selection.actor)
	const scopedActor = Option.filter(props.selection.actor, () => props.selection.scoped)
	const unit = Array.findFirst(props.view.frame.units, entry => entry.id === actor)
	const kind = Option.getOrElse(
		Option.map(unit, entry => entry.kind),
		() => {
			if (selected === undefined) return members[actor ?? '']?.kind ?? 'individual'
			return actorKind(selected, members)
		}
	)
	const picked = Array.findFirst(
		props.view.teams,
		team => team.id === filter || (filter === -1 && team.status === 'thinking')
	)
	return (
		<div className="pointer-events-none absolute inset-x-0 top-16 bottom-16 z-20 flex items-end p-2 md:top-20 md:p-4">
			<aside
				aria-label="Inspector"
				className={cn(
					// A panel holds dense text, so it stays opaque; only the small floating chrome blurs the world behind it.
					'border-border bg-popover text-popover-foreground pointer-events-auto flex max-h-1/2 min-h-0 w-full flex-col overflow-hidden border md:max-h-full md:w-80',
					actor !== undefined && 'max-h-2/3 lg:w-160'
				)}
			>
				<header className="border-border flex h-11 flex-none items-center gap-2 border-b px-3">
					{Option.match(scopedActor, {
						onNone: () => <ChatsIcon className="size-4 shrink-0" />,
						onSome: () => <EyeIcon className="size-4 shrink-0" />
					})}
					<h2 className="font-heading min-w-0 truncate text-lg leading-none tracking-tight">
						{Option.match(scopedActor, {onNone: () => 'Thread', onSome: id => actorName(kind, id)})}
					</h2>
					<Badge variant="secondary" className="shrink-0">
						{Option.match(scopedActor, {onNone: () => teamName(filter), onSome: () => 'History'})}
					</Badge>
					<Button
						className="ml-auto size-9 max-sm:size-11"
						size="icon-sm"
						aria-label="Close inspector"
						variant="ghost"
						onClick={props.close}
					>
						<XIcon className="size-4" />
					</Button>
				</header>
				<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
					<div className="flex min-h-28 min-w-0 flex-1 flex-col">
						{Option.match(scopedActor, {
							onNone: () => (
								<Thread
									key={filter}
									team={filter}
									status={Option.getOrUndefined(
										Option.map(
											Option.filter(picked, () => Option.isNone(props.source)),
											team => team.status
										)
									)}
								/>
							),
							onSome: id => <Chronicle key={id} actor={id} />
						})}
					</div>
					{actor !== undefined && (
						<section
							aria-label="Entity details"
							className={cn(
								'border-border flex max-h-60 min-h-0 shrink-0 flex-col border-t lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l',
								selected !== undefined && 'h-56 lg:h-auto'
							)}
						>
							<header className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
								<Portrait kind={kind} className="size-7" />
								<span className="tracking-label min-w-0 truncate text-xs font-semibold uppercase">
									{actorName(kind, actor)}
								</span>
								{selected !== undefined && (
									<time className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
										{clockOf(selected.tick)}
									</time>
								)}
								<Button
									variant="ghost"
									size="sm"
									className="ml-auto max-sm:h-11"
									onClick={props.clear}
									aria-label="Clear entity selection"
								>
									Clear
								</Button>
							</header>
							<div className="min-h-0 flex-1">
								<ScrollArea className="size-full">
									<div className="p-3 text-xs select-text">
										{Option.getOrUndefined(
											Option.map(
												Option.filter(unit, () => selected?.context === undefined),
												current => <Followed unit={current} />
											)
										)}
										{Option.match(props.selection.entry, {
											onNone: () => (
												<Empty role="status" aria-label="No decision selected">
													<EmptyHeader>
														<EmptyMedia variant="icon">
															<EyeIcon weight="light" className="size-5" />
														</EmptyMedia>
														<h2 className="font-heading text-lg leading-snug tracking-tight">Nothing selected</h2>
														<EmptyDescription>
															Choose a message in the thread to read its recorded perception and choices.
														</EmptyDescription>
													</EmptyHeader>
												</Empty>
											),
											onSome: entry => <RequestDetails entry={entry} />
										})}
									</div>
								</ScrollArea>
							</div>
						</section>
					)}
				</div>
			</aside>
		</div>
	)
}

function SpectatorControls(props: {
	coverage: boolean
	source: Source
	tick: number
	threadOpen: boolean
	onCentre: () => void
	onLive: () => void
	onThreads: () => void
}) {
	const [chunks, setChunks] = useAtom(chunksAtom)
	const live = Option.isNone(props.source)
	return (
		<section
			aria-label="Spectator controls"
			className="pointer-events-none absolute inset-x-2 bottom-2 z-30 flex items-end justify-between gap-2 md:inset-x-4 md:bottom-4"
		>
			<div className={cn(MAP_CONTROLS, 'pointer-events-auto flex shrink-0 items-stretch p-1')}>
				<Button
					className="size-11 md:size-9"
					variant={Boolean.match(props.coverage && chunks, {
						onFalse: () => 'ghost' as const,
						onTrue: () => 'secondary' as const
					})}
					size="icon-sm"
					aria-pressed={props.coverage && chunks}
					aria-label={Boolean.match(props.coverage, {
						onFalse: () => 'Chunk coverage: nothing explored yet',
						onTrue: () => 'Chunk coverage'
					})}
					title={Boolean.match(props.coverage, {
						onFalse: () => 'Chunk coverage appears once a unit explores',
						onTrue: () => {
							if (chunks) return 'Hide chunk coverage'
							return 'Show chunk coverage'
						}
					})}
					disabled={!props.coverage}
					onClick={() => setChunks(!chunks)}
				>
					<SquaresFourIcon className="size-4" />
				</Button>
				<Button
					className="size-11 md:size-9"
					variant="ghost"
					size="icon-sm"
					aria-label="Recenter the world"
					title="Recenter the world"
					onClick={props.onCentre}
				>
					<CrosshairIcon className="size-4" />
				</Button>
				<Button
					className="size-11 md:size-9"
					variant={Boolean.match(props.threadOpen, {
						onFalse: () => 'ghost' as const,
						onTrue: () => 'secondary' as const
					})}
					size="icon-sm"
					aria-pressed={props.threadOpen}
					aria-label="Thread"
					title={Boolean.match(props.threadOpen, {onFalse: () => 'Show thread', onTrue: () => 'Hide thread'})}
					onClick={props.onThreads}
				>
					<ChatsIcon className="size-4" />
				</Button>
			</div>
			{!live && (
				<div className={cn(MAP_CONTROLS, 'pointer-events-auto flex shrink-0 items-stretch p-1')}>
					<Button variant="ghost" size="sm" className="max-sm:h-11" aria-label="Return to live" onClick={props.onLive}>
						<time className="text-muted-foreground font-mono text-xs tracking-normal normal-case tabular-nums">
							{String.replace(/^0:/u, '')(clockOf(props.tick))}
						</time>
						<span className="flex items-center gap-1 leading-none">
							<BroadcastIcon className="size-4" />
							Live
							<ArrowUpRightIcon className="size-3" />
						</span>
					</Button>
				</div>
			)}
		</section>
	)
}

// The hover card: the portrait beside what the unit or creature is doing, with its health.
function Card(props: {unit: UnitView}) {
	return (
		<div className={cn(MAP_SURFACE, 'absolute bottom-7 left-0 flex w-60 -translate-x-1/2 items-center gap-3 p-2.5')}>
			<Portrait kind={props.unit.kind} className="size-9" />
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-1.5 first-letter:uppercase">
					{props.unit.team !== undefined && <Swatch team={props.unit.team} />}
					{doingOf(props.unit)}
				</p>
				<Meter value={percent(props.unit.health)}>
					<Pips value={props.unit.health} />
				</Meter>
			</div>
		</div>
	)
}

// The hover card for the ground: the building on it with what it is doing, an ore field with the ore it has left, or what stands on the tile.
function GroundCard(props: {building: Option.Option<BuildingView>; info: Option.Option<Inspected>}) {
	return (
		<div className={cn(MAP_SURFACE, 'absolute bottom-4 left-0 w-max max-w-60 -translate-x-1/2 px-2.5 py-1.5')}>
			{Option.getOrUndefined(
				Option.map(props.building, building => (
					<p className="flex items-start gap-1.5">
						<Swatch team={building.team} className="mt-1" />
						<span>{building.status}</span>
					</p>
				))
			)}
			{Option.getOrUndefined(
				Option.map(
					Option.flatMap(
						Option.filter(props.info, () => Option.isNone(props.building)),
						info => Option.fromUndefinedOr(info.field)
					),
					field => (
						<p>
							{String.capitalize(field.material)} ·{' '}
							<span className="text-muted-foreground font-mono text-xs tabular-nums">
								{field.left.toLocaleString('en', {maximumFractionDigits: 1, notation: 'compact'})} left
							</span>
						</p>
					)
				)
			)}
		</div>
	)
}

function Status(props: {children: ReactNode; icon?: ReactNode; tone?: 'quiet' | 'warning'}) {
	return (
		<Panel className="pointer-events-none inset-x-4 bottom-16 z-50 mx-auto w-fit max-w-full px-3 py-2 md:bottom-4">
			<p
				role="status"
				className={cn(
					'flex items-center gap-2 text-xs',
					Boolean.match(props.tone === 'warning', {
						onFalse: () => 'text-muted-foreground',
						onTrue: () => 'text-warning'
					})
				)}
			>
				{props.icon}
				{props.children}
			</p>
		</Panel>
	)
}

// The building whose footprint covers a tile.
function buildingAt(buildings: View['buildings'], at: {x: number; z: number}) {
	return Array.findFirst(
		buildings,
		building =>
			Math.floor(at.x) >= building.x &&
			Math.floor(at.x) < building.x + building.w &&
			Math.floor(at.z) >= building.z &&
			Math.floor(at.z) < building.z + building.d
	)
}

// The camera follows a place, a unit as drawn, or the team's Home.
function aimOf(follow: Follow, team: number, view: View, world: {cast: Cast; renderer: Renderer}) {
	const home = Option.getOrElse(
		Option.map(
			Array.findFirst(view.teams, entry => entry.id === team || team === -1),
			entry => entry.home
		),
		() => ({x: 0, z: 0})
	)
	return Option.match(follow.free, {
		onNone: () =>
			Option.match(
				Option.flatMap(follow.id, id =>
					Option.map(
						Option.orElse(world.cast.positionOf(id), () =>
							Option.map(
								Array.findFirst(view.buildings, building => building.id === id),
								building => ({
									x: building.x + building.w / 2,
									y: world.renderer.ground(building.x, building.z),
									z: building.z + building.d / 2
								})
							)
						),
						at => ({at, id})
					)
				),
				{
					onNone: () => {
						const at = follow.fallback ?? home
						return {
							key: `missing:${Option.getOrElse(
								Option.map(follow.id, id => `${id}`),
								() => `home:${team}`
							)}`,
							x: at.x,
							y: world.renderer.ground(at.x, at.z),
							z: at.z
						}
					},
					onSome: followed => ({key: `unit:${followed.id}`, ...followed.at})
				}
			),
		onSome: at => ({key: `free:${at.x}:${at.z}`, x: at.x, y: world.renderer.ground(at.x, at.z), z: at.z})
	})
}

// Over the world: health pips over hurt units, the hover card over the unit under the pointer, else the ground card under it. The world view moves each into place every frame.
function Overlay(props: {
	buildings: View['buildings']
	inspection: Option.Option<Inspection>
	units: View['frame']['units']
}) {
	const ground = useAtomValue(groundAtom)
	const hover = Option.filter(useAtomValue(hoverAtom), () => Option.isNone(props.inspection))
	const hovered = Option.flatMap(ground.at, at => buildingAt(props.buildings, at))
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			{Array.map(
				Array.filter(props.units, unit => unit.health < 0.999 && unit.act !== 'die' && isUnit(unit.kind)),
				unit => (
					<div key={unit.id} data-follow={unit.id} data-pips hidden className="absolute top-0 left-0">
						<div className="bg-popover/90 -mt-5 -ml-5 w-10 border p-0.5">
							<Pips value={unit.health} />
						</div>
					</div>
				)
			)}
			{Option.getOrUndefined(
				Option.map(
					Option.flatMap(hover, entry => Array.findFirst(props.units, unit => `${unit.id}` === entry.id)),
					unit => (
						<div data-follow={unit.id} hidden className="absolute top-0 left-0">
							<Card unit={unit} />
						</div>
					)
				)
			)}
			{Option.isNone(props.inspection) &&
				(Option.isSome(hovered) || Option.isSome(ground.info)) &&
				Option.isNone(hover) && (
					<div
						className="absolute top-(--y) left-(--x)"
						style={{'--x': `clamp(132px, ${ground.x}px, calc(100% - 132px))`, '--y': `${Number.max(120, ground.y)}px`}}
					>
						<GroundCard building={hovered} info={ground.info} />
					</div>
				)}
		</div>
	)
}

function useMapGestures(props: {
	world: Option.Option<{cast: Cast; renderer: Renderer}>
	view: View
	onPick: (id: number) => void
	onGround: (at: Option.Option<{x: number; z: number}>, x: number, y: number) => void
}) {
	const setHover = useAtomSet(hoverAtom)
	const setFollow = useAtomSet(followAtom)
	// A press on the world: how far it has dragged and where the pointer was; -1 while nothing is pressed.
	const drag = useRef({moved: -1, x: 0, y: 0})
	const pointers = useRef<Record<string, {x: number; y: number}>>({})
	// A press starts a drag that pans the view; let go without dragging, it is a click.
	function down(event: PointerEvent<HTMLCanvasElement>) {
		if (event.button !== 0) return
		event.currentTarget.focus()
		event.currentTarget.setPointerCapture(event.pointerId)
		pointers.current[event.pointerId] = {x: event.clientX, y: event.clientY}
		drag.current = {
			moved: Boolean.match(Record.keys(pointers.current).length > 1, {onFalse: () => 0, onTrue: () => 5}),
			x: event.clientX,
			y: event.clientY
		}
	}

	function up(event: PointerEvent<HTMLCanvasElement>) {
		const dragged = drag.current.moved > 4
		pointers.current = Record.remove(pointers.current, `${event.pointerId}`)
		drag.current = Option.match(Array.head(Record.values(pointers.current)), {
			onNone: () => ({moved: -1, x: 0, y: 0}),
			onSome: point => ({moved: 5, ...point})
		})
		if (dragged) {
			if (Array.isArrayEmpty(Record.keys(pointers.current))) {
				Option.match(props.world, {
					onNone: () => undefined,
					onSome: active => setFollow(current => ({...current, free: Option.some(active.renderer.detach())}))
				})
			}
			return
		}
		// A click on a team's unit follows it.
		const bounds = event.currentTarget.getBoundingClientRect()
		Option.match(
			Option.filter(
				Option.flatMap(props.world, active =>
					active.cast.pick(event.clientX - bounds.left, event.clientY - bounds.top)
				),
				id => Array.some(props.view.frame.units, unit => unit.id === id)
			),
			{
				onNone: () =>
					Option.match(props.world, {
						onNone: () => undefined,
						onSome: active =>
							props.onGround(active.renderer.inspect(event.clientX, event.clientY), event.clientX, event.clientY)
					}),
				onSome: props.onPick
			}
		)
	}

	function move(event: PointerEvent<HTMLCanvasElement>) {
		if (Record.keys(pointers.current).length > 1) {
			const before = Record.values(pointers.current)
			pointers.current[event.pointerId] = {x: event.clientX, y: event.clientY}
			const after = Record.values(pointers.current)
			const first = before[0],
				second = before[1],
				nextFirst = after[0],
				nextSecond = after[1]
			if (first !== undefined && second !== undefined && nextFirst !== undefined && nextSecond !== undefined) {
				Option.match(props.world, {
					onNone: () => undefined,
					onSome: active =>
						active.renderer.zoomBy(
							Math.hypot(first.x - second.x, first.y - second.y) /
								Number.max(1, Math.hypot(nextFirst.x - nextSecond.x, nextFirst.y - nextSecond.y))
						)
				})
			}
			drag.current.moved = 5
			return
		}
		if (drag.current.moved >= 0) {
			pointers.current[event.pointerId] = {x: event.clientX, y: event.clientY}
			const dx = event.clientX - drag.current.x
			const dy = event.clientY - drag.current.y
			drag.current = {moved: drag.current.moved + Math.hypot(dx, dy), x: event.clientX, y: event.clientY}
			Option.match(props.world, {onNone: () => undefined, onSome: active => active.renderer.pan(dx, dy)})
			return
		}
		Option.match(props.world, {
			onNone: () => undefined,
			onSome: active => {
				const bounds = event.currentTarget.getBoundingClientRect()
				const picked = active.cast.pick(event.clientX - bounds.left, event.clientY - bounds.top)
				setHover(Option.map(picked, id => ({id: `${id}`, x: event.clientX, y: event.clientY})))
				// Off the units, the ground under the pointer: the building on it from the frames, the rest from the chunk worker.
				props.onGround(
					Option.filter(active.renderer.inspect(event.clientX, event.clientY), () => Option.isNone(picked)),
					event.clientX,
					event.clientY
				)
			}
		})
	}

	function wheel(event: WheelEvent<HTMLCanvasElement>) {
		Option.match(props.world, {
			onNone: () => undefined,
			onSome: active => active.renderer.zoomBy(Math.exp(event.deltaY * wheelRate(event.ctrlKey)))
		})
	}

	return {
		cancel: () => {
			pointers.current = {}
			drag.current = {moved: -1, x: 0, y: 0}
		},
		down,
		leave: (event: PointerEvent<HTMLCanvasElement>) => {
			if (event.pointerType === 'touch') return
			setHover(Option.none())
			props.onGround(Option.none(), 0, 0)
		},
		lost: (event: PointerEvent<HTMLCanvasElement>) => {
			pointers.current = Record.remove(pointers.current, `${event.pointerId}`)
			if (Array.isArrayEmpty(Record.keys(pointers.current))) drag.current.moved = -1
		},
		move,
		up,
		wheel
	}
}

// Money is a figure: mono, tabular, and only a reported cost is a price rather than a missing one.
function priceOf(cost: number) {
	return `$${cost.toLocaleString('en', {maximumFractionDigits: 4, minimumFractionDigits: 2})}`
}

function SpendDetail(props: {mode: UsageMode; total: ReturnType<typeof spendOf>}) {
	if (props.total.reported === 0) {
		return (
			<Empty role="status" aria-label={`No reported ${props.mode} spend`}>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<CoinsIcon weight="light" className="size-5" />
					</EmptyMedia>
					<h2 className="font-heading text-lg leading-snug tracking-tight">No reported spend</h2>
					<EmptyDescription>{fieldName(props.mode)} has no request whose cost was reported.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		)
	}
	return (
		<>
			<div className="border-border divide-border divide-y border-y">
				{Array.map(
					Array.sortWith(props.total.models, model => model.cost, Order.flip(Number.Order)),
					model =>
						model.reported > 0 && (
							<div key={model.model} className="flex items-baseline justify-between gap-3 py-2">
								<span className="min-w-0 truncate font-mono text-xs">{model.model}</span>
								<span className="shrink-0 font-mono text-xs tabular-nums">{priceOf(model.cost)}</span>
							</div>
						)
				)}
			</div>
			{props.total.reported < props.total.calls && (
				<p className="text-muted-foreground text-xs leading-relaxed">
					Cost reported for {props.total.reported} of {props.total.calls} requests. Unreported costs aren’t included.
				</p>
			)}
		</>
	)
}

// The build's environment wins when it has reported spend; otherwise the other environment is the useful one.
function preferredMode(development: ReturnType<typeof spendOf>, production: ReturnType<typeof spendOf>) {
	if (USAGE_MODE === 'development') {
		if (development.reported > 0 || production.reported === 0) return 'development' satisfies UsageMode
		return 'production' satisfies UsageMode
	}
	if (production.reported > 0 || development.reported === 0) return 'production' satisfies UsageMode
	return 'development' satisfies UsageMode
}

function SpendBody(props: {ledger: UsageLedger}) {
	const development = spendOf(props.ledger, 'development')
	const production = spendOf(props.ledger, 'production')
	const [mode, setMode] = useState<UsageMode>(() => preferredMode(development, production))
	if (development.reported === 0 && production.reported === 0) return null
	const total = Boolean.match(mode === 'development', {onFalse: () => production, onTrue: () => development})
	const price = Boolean.match(total.reported > 0, {onFalse: () => '—', onTrue: () => priceOf(total.cost)})
	return (
		<div className="border-border flex items-center border-l">
			<Popover>
				<PopoverTrigger
					render={<Button variant="ghost" size="sm" className="max-sm:h-11" />}
					aria-label={Boolean.match(total.reported > 0, {
						onFalse: () => `No reported ${mode} model spend`,
						onTrue: () => `${fieldName(mode)} reported model spend: ${price}`
					})}
				>
					<span className="font-mono text-xs tracking-normal normal-case tabular-nums">{price}</span>
					<Badge variant="secondary">
						{Boolean.match(mode === 'development', {onFalse: () => 'Prod', onTrue: () => 'Dev'})}
					</Badge>
				</PopoverTrigger>
				<PopoverContent align="end">
					<PopoverTitle>Reported spend</PopoverTitle>
					<Tabs
						value={mode}
						onValueChange={value =>
							setMode(Boolean.match(value === 'production', {onFalse: () => 'development', onTrue: () => 'production'}))
						}
					>
						<TabsList variant="line" className="w-full">
							<TabsTrigger value="development" className="flex-1">
								Development
							</TabsTrigger>
							<TabsTrigger value="production" className="flex-1">
								Production
							</TabsTrigger>
						</TabsList>
						<TabsContent value="development">
							<SpendDetail mode="development" total={development} />
						</TabsContent>
						<TabsContent value="production">
							<SpendDetail mode="production" total={production} />
						</TabsContent>
					</Tabs>
				</PopoverContent>
			</Popover>
		</div>
	)
}

function Spend() {
	return Option.match(AsyncResult.value(useAtomValue(usageAtom)), {
		onNone: () => null,
		onSome: ledger => <SpendBody ledger={ledger} />
	})
}

// A configuration warning is a sentence, not a timer: it names the cause and how to restore decisions.
function ConfigurationNotice() {
	return Option.match(Option.liftPredicate(useAtomValue(configurationAtom), Array.isReadonlyArrayNonEmpty), {
		onNone: () => null,
		onSome: items => {
			const label = Array.join(
				Array.map(items, notice => String.split(' · ')(notice)[0]),
				' · '
			)
			return (
				<Popover>
					<PopoverTrigger render={<Button variant="ghost" size="sm" className="max-sm:h-11" />} aria-label={label}>
						<WarningCircleIcon className="text-warning size-3.5 shrink-0" />
						<span className="tracking-label hidden text-xs font-semibold uppercase md:inline">{label}</span>
					</PopoverTrigger>
					<PopoverContent align="end">
						<PopoverTitle>{label}</PopoverTitle>
						<p className="text-muted-foreground text-xs leading-relaxed">
							Set OPENROUTER_API_KEY on the server run; local decisions may also be off there. This page never starts or
							resumes paid inference.
						</p>
					</PopoverContent>
				</Popover>
			)
		}
	})
}

// The mark, name and honest world state stay a compact mark over the map, never a bar.
function Identity() {
	const source = useAtomValue(sourceAtom)
	const status = useAtomValue(runStateAtom)
	const live = Option.isNone(source)
	const running = Option.getOrUndefined(AsyncResult.value(status))?.running === true
	const state = worldState(live, AsyncResult.isFailure(status), Option.isNone(AsyncResult.value(status)), running)
	return (
		<div
			className={cn(
				MAP_CONTROLS,
				'pointer-events-auto flex h-11 min-w-0 shrink-0 items-center gap-2.5 px-3 max-sm:h-13'
			)}
		>
			<img src={icon} alt="" className="pixelated size-6 shrink-0 opacity-90" />
			<h1 className="font-heading shrink-0 text-xl leading-none tracking-tight">Signal</h1>
			<span aria-hidden="true" className="bg-border mx-0.5 h-3 w-px shrink-0" />
			<span
				role="status"
				className="flex min-w-0 items-center gap-1.5"
				title={Boolean.match(state.label === 'Paused', {
					onFalse: () => undefined,
					onTrue: () => 'The server run is stopped; this page never starts or resumes it.'
				})}
			>
				<StatusDot status={state.dot} waiting={state.waiting} />
				<span
					className={cn(
						'tracking-label text-xs font-semibold uppercase',
						Boolean.match(state.dot === 'live', {
							onFalse: () => 'text-muted-foreground',
							onTrue: () => 'text-foreground'
						})
					)}
				>
					{state.label}
				</span>
			</span>
			{/* A historical view still owes the run's own state: the world may be live or stopped behind it. */}
			{Boolean.match(live, {
				onFalse: () => (
					<>
						<span aria-hidden="true" className="bg-border mx-0.5 h-3 w-px shrink-0" />
						<span className="flex min-w-0 items-center gap-1.5">
							<StatusDot status={Boolean.match(running, {onFalse: () => 'quiet', onTrue: () => 'live'})} />
							<span
								className={cn(
									'tracking-label text-xs font-semibold uppercase',
									Boolean.match(running, {onFalse: () => 'text-muted-foreground', onTrue: () => 'text-foreground'})
								)}
							>
								{Boolean.match(running, {onFalse: () => 'Paused', onTrue: () => 'Live'})}
							</span>
						</span>
					</>
				),
				onTrue: () => null
			})}
			<ConfigurationNotice />
		</div>
	)
}

function MapControls(props: {view: View; onTeam: (team: number) => void}) {
	return (
		<header className="pointer-events-none absolute inset-x-2 top-2 z-30 flex flex-wrap items-start gap-2 md:inset-x-4 md:top-4 md:flex-nowrap md:justify-between">
			<Identity />
			<nav aria-label="Models" className={cn(MAP_CONTROLS, 'pointer-events-auto flex min-w-0 items-stretch p-1')}>
				<ToggleGroup
					aria-label="Models"
					className="min-w-0"
					value={[route.useSearch({select: search => `${search.team ?? -1}`})]}
					onValueChange={values =>
						Option.match(Option.flatMap(Array.head(values), Number.parse), {
							onNone: () => undefined,
							onSome: props.onTeam
						})
					}
				>
					<ToggleGroupItem
						value="-1"
						aria-label="All models"
						title="All models"
						size="sm"
						className="relative max-md:h-11"
					>
						<RobotIcon className="size-4" />
						{/* The selected model keeps its fill and adds a rule in its own colour, which reads on both chrome appearances. */}
						<span
							aria-hidden="true"
							className="bg-foreground pointer-events-none absolute inset-x-3 bottom-1 h-0.5 opacity-0 transition-opacity group-aria-pressed/toggle:opacity-100"
						/>
					</ToggleGroupItem>
					{Array.map(props.view.teams, entry => (
						<ToggleGroupItem
							key={entry.id}
							value={`${entry.id}`}
							aria-label={entry.name}
							title={entry.name}
							size="sm"
							className="relative max-md:h-11"
						>
							<span className="block text-(--team-text)" style={{'--team-text': teamTextColor(entry.id)}}>
								<TeamIcon team={entry.id} className="size-4" />
							</span>
							<span
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-3 bottom-1 h-0.5 bg-(--team) opacity-0 transition-opacity group-aria-pressed/toggle:opacity-100"
								style={{'--team': teamColor(entry.id)}}
							/>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<Spend />
			</nav>
		</header>
	)
}

function ReplayLoading() {
	const loading = useAtomValue(loadingAtom)
	const source = useAtomValue(sourceAtom)
	if (!loading) return null
	return (
		<Status icon={<Spinner className="size-3 shrink-0" />}>
			{Option.match(source, {onNone: () => 'Rejoining live', onSome: () => 'Loading history'})}
		</Status>
	)
}

function DrawingWorld() {
	return (
		<div id="drawing-world" className="bg-background absolute inset-0 z-20 flex items-center justify-center">
			<div
				role="status"
				aria-label="Drawing the world"
				className="flex max-w-xs flex-col items-center gap-3 px-6 text-center"
			>
				<img src={icon} alt="" className="pixelated size-8 opacity-80" />
				<h2 className="font-heading text-2xl leading-none tracking-tight">Drawing the world</h2>
				<p className="text-muted-foreground flex items-center gap-2 text-xs">
					<Spinner className="size-3" />
					Terrain is arriving.
				</p>
			</div>
		</div>
	)
}

function World(props: {seed: number; view: View}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [world, setWorld] = useState(Option.none<{cast: Cast; renderer: Renderer}>)
	// The tile under the pointer, what the chunk worker said lies on it, and the pointer's place on screen.
	const setGround = useAtomSet(groundAtom)
	const setFollow = useAtomSet(followAtom)
	const team = route.useSearch({select: search => search.team ?? -1})
	const navigate = route.useNavigate()
	const [source, setSource] = useAtom(sourceAtom)
	const [panel, setPanel] = useState(Option.none<Inspection>)
	const cursor = useAtomValue(cursorAtom)

	const [portraits, setPortraits] = useState<Record<string, string>>({})
	// What the key handler and the camera read, kept current outside render.
	const latest = useRef({team, view: props.view})
	useEffect(() => {
		latest.current = {team, view: props.view}
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.invalidate()})
	}, [props.view, team, world])

	useEffect(() => {
		const target = canvas.current
		if (target === null) return
		target.addEventListener('wheel', preventMapWheel, {passive: false})
		const renderer = createRenderer(target, props.seed)
		const overlay = document.getElementById('drawing-world')
		renderer.onTerrain(ready => {
			if (overlay !== null) overlay.style.display = Boolean.match(ready, {onFalse: () => 'flex', onTrue: () => 'none'})
		})
		const cast = createCast(renderer)
		const active = {cast, renderer}
		cast.onPortrait(() => setPortraits(cast.portraits()))
		renderer.onInspected(answer =>
			setGround(before => ({
				...before,
				info: Option.filter(
					Option.liftPredicate(answer, entry => entry.field !== undefined),
					() => Option.isSome(before.at)
				)
			}))
		)
		const seen: {count: number; traces: View['traces']; zones: View['zones']} = {count: 0, traces: {}, zones: []}
		const frames = registry.subscribe(
			viewAtom,
			result => {
				const view = Option.getOrUndefined(AsyncResult.value(result))
				if (view === undefined || view.count === 0) return
				latest.current.view = view
				// A stream's first frame starts the world over; a view joined midway starts from all it has.
				if (view.count === 1 || seen.count === 0 || view.count < seen.count) {
					if (seen.count > 0) {
						renderer.reset()
						cast.reset()
					}
					renderer.changes(Record.values(view.changes))
					renderer.cleared(view.cleared)
					renderer.explored(Record.values(view.explored))
					cast.places(view.buildings)
				} else {
					renderer.changes(view.frame.changes)
					renderer.cleared(view.frame.cleared)
					renderer.explored(view.frame.explored)
					if (view.frame.buildings !== undefined) cast.places(view.buildings)
				}
				seen.count = view.count
				renderer.footprints(view.buildings)
				if (view.zones !== seen.zones) {
					seen.zones = view.zones
					renderer.zones(
						view.zones,
						Array.map(TEAMS, entry => entry.color)
					)
				}
				renderer.daylight(view.frame.environment?.daylight ?? 1)
				if (seen.traces !== view.traces) {
					seen.traces = view.traces
					renderer.traces(Record.values(view.traces))
				}
				cast.frame(view.frame)
				// A replay that caught up with the live world is the live world.
				Option.match(registry.get(sourceAtom), {
					onNone: () => undefined,
					onSome: replay => {
						if (replay.speed > 0 && view.frame.live !== undefined && view.frame.tick >= view.frame.live - TICK_HZ) {
							registry.set(sourceAtom, Option.none())
						}
					}
				})
			},
			{immediate: true}
		)
		const chunksChanged = registry.subscribe(chunksAtom, renderer.invalidate)
		const followChanged = registry.subscribe(followAtom, renderer.invalidate)
		const runChanged = registry.subscribe(runStateAtom, renderer.invalidate)
		const sourceChanged = registry.subscribe(sourceAtom, renderer.invalidate)
		const hoverChanged = registry.subscribe(hoverAtom, renderer.invalidate)
		const groundChanged = registry.subscribe(groundAtom, renderer.invalidate)
		// Each frame, before the camera moves: it aims at its subject, and the followed unit is edged.
		renderer.onFrame(() => {
			renderer.showChunks(registry.get(chunksAtom))
			const current = registry.get(followAtom)
			const run = Option.getOrUndefined(AsyncResult.value(registry.get(runStateAtom)))
			renderer.clock(
				latest.current.view.frame.tick,
				Option.match(registry.get(sourceAtom), {
					onNone: () => Boolean.match(run?.running === true, {onFalse: () => 0, onTrue: () => 1}),
					onSome: replay => replay.speed
				})
			)
			renderer.aim(aimOf(current, latest.current.team, latest.current.view, active))
			renderer.focus(
				Option.flatMap(current.id, id => cast.objectOf(id)),
				teamColor(latest.current.team)
			)
		})
		// Once the camera has moved: health pips and the hover card follow their units. Zoomed far out, pips only clutter, so they hide.
		renderer.onDrawn(() => {
			// Past 16 tiles above and below the view's middle, health pips hide.
			const far = renderer.span() > 16
			// The overlay sits beside the canvas.
			for (const element of Array.fromIterable(
				canvas.current?.parentElement?.querySelectorAll<HTMLElement>('[data-follow]') ?? []
			)) {
				const point = Option.getOrUndefined(
					Option.flatMap(Number.parse(element.dataset['follow'] ?? ''), id => cast.screenOf(id))
				)
				element.hidden = point === undefined || (far && element.dataset['pips'] !== undefined)
				if (point !== undefined) {
					element.style.transform = `translate(${Number.round(point.x, 0)}px, ${Number.round(point.y, 0)}px)`
				}
			}
		})
		function cycle(step: number) {
			const own = unitsOf(latest.current.view.frame.units, latest.current.team)
			const current = registry.get(followAtom)
			const index = Option.getOrElse(
				Array.findFirstIndex(own, unit => Option.contains(current.id, unit.id)),
				() => -step
			)
			const id = Option.map(Array.get(own, (((index + step) % own.length) + own.length) % own.length), unit => unit.id)
			registry.set(followAtom, {free: Option.none(), id})
			if (Option.isSome(id)) {
				setPanel(before =>
					Option.map(before, inspection => {
						if (!inspection.scoped) return inspection
						return {...inspection, actor: id, entry: Option.none()}
					})
				)
			}
			renderer.centre()
		}
		// Esc frees the camera where it looks, then follows the team's next unit.
		function leave() {
			if (Option.isNone(registry.get(followAtom).free)) {
				registry.set(followAtom, {free: Option.some(renderer.looking()), id: Option.none()})
			} else {
				cycle(1)
			}
		}
		function pick(next: number) {
			navigate({search: teamSearch(next)})
			registry.set(followAtom, {free: Option.none(), id: Option.none()})
			renderer.centre()
		}
		// Arrow keys pan by a screen step, as a drag does; the pan stays until a subject or recenter takes it back.
		function glideBy(dx: number, dy: number) {
			return () => {
				renderer.pan(dx, dy)
			}
		}
		const actions = {
			down: glideBy(0, -80),
			in: () => renderer.zoomBy(1 / ZOOM_STEP),
			leave,
			left: glideBy(80, 0),
			next: () => cycle(1),
			out: () => renderer.zoomBy(ZOOM_STEP),
			previous: () => cycle(-1),
			right: glideBy(-80, 0),
			up: glideBy(0, 80)
		} satisfies Record<Key, () => void>
		function keys(event: KeyboardEvent) {
			if (event.target !== canvas.current) return
			if (!event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
				const selected = Array.findFirst(latest.current.view.teams, entry => event.code === `Digit${entry.id + 1}`)
				if (Option.isSome(selected)) {
					pick(Option.getOrThrow(selected).id)
					event.preventDefault()
					return
				}
			}
			Option.match(keyOf(event), {
				onNone: () => undefined,
				onSome: key => {
					event.preventDefault()
					actions[key]()
				}
			})
		}
		addEventListener('keydown', keys)
		setWorld(Option.some(active))
		return () => {
			target.removeEventListener('wheel', preventMapWheel)
			removeEventListener('keydown', keys)
			frames()
			chunksChanged()
			followChanged()
			runChanged()
			sourceChanged()
			hoverChanged()
			groundChanged()
			cast.dispose()
			renderer.dispose()
		}
	}, [registry, props.seed, setGround, navigate])

	function followUnit(id: number) {
		const unit = Option.getOrUndefined(Array.findFirst(props.view.frame.units, entry => entry.id === id))
		if (unit?.team !== undefined) navigate({search: teamSearch(unit.team)})
		setFollow({free: Option.none(), id: Option.some(id)})
		setPanel(Option.some({actor: Option.some(id), entry: Option.none(), scoped: true}))
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
	}

	const gestures = useMapGestures({
		onGround: (at, x, y) =>
			setGround(before => ({
				at,
				info: Option.filter(before.info, () => Option.isSome(at)),
				x: x - (canvas.current?.getBoundingClientRect().left ?? 0),
				y: y - (canvas.current?.getBoundingClientRect().top ?? 0)
			})),
		onPick: followUnit,
		view: props.view,
		world
	})

	useEffect(() => {
		const target = canvas.current
		const active = Option.getOrUndefined(world)
		if (target === null || active === undefined) return
		const inspector = Option.getOrUndefined(Option.map(panel, () => target.parentElement?.querySelector('aside')))
		function measure() {
			const frame = target?.getBoundingClientRect()
			if (frame === undefined || frame.width === 0 || frame.height === 0) return
			const bounds = inspector?.getBoundingClientRect()
			const available = {bottom: frame.height - 64, left: 0, right: frame.width, top: 64}
			if (bounds !== undefined) {
				if (frame.width >= 768) available.left = bounds.right - frame.left + 12
				else available.bottom = bounds.top - frame.top - 12
			}
			active?.renderer.frameAt(
				(available.left + available.right) / frame.width / 2,
				(available.top + available.bottom) / frame.height / 2
			)
		}
		const observer = new ResizeObserver(measure)
		observer.observe(target)
		if (Predicate.isNotNullish(inspector)) observer.observe(inspector)
		measure()
		return () => {
			observer.disconnect()
			active.renderer.frameAt(0.5, 0.5)
		}
	}, [world, panel])

	function locateEntity(id: number, tick: number, fallback?: {x: number; z: number}) {
		if (id < 0) {
			setFollow({free: Option.some(tileOf(-1 - id)), id: Option.none()})
		} else {
			setFollow({fallback, free: Option.none(), id: Option.some(id)})
		}
		setSource(Option.some({from: tick, speed: 0}))
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
	}

	return (
		<Navigation
			value={{
				core: (owner, tick) => {
					Option.match(
						Array.findFirst(props.view.teams, entry => entry.id === owner),
						{onNone: () => undefined, onSome: entry => setFollow({free: Option.some(entry.home), id: Option.none()})}
					)
					setSource(Option.some({from: tick, speed: 0}))
					Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
				},
				entity: (id, tick, fallback) => {
					locateEntity(id, tick, fallback)
					if (id < 0) return
					setPanel(before =>
						Option.some({
							actor: Option.some(id),
							entry: Option.none(),
							scoped: Option.exists(before, inspection => inspection.scoped)
						})
					)
				},
				event: entry => {
					locateEntity(eventSubject(entry), entry.tick, {x: entry.x, z: entry.z})
					setPanel(before =>
						Option.some({
							actor: Option.some(entry.actor),
							entry: Option.some(entry),
							scoped: Option.exists(before, inspection => inspection.scoped)
						})
					)
				},
				place: (x, z, tick) => {
					setFollow({free: Option.some({x, z}), id: Option.none()})
					setSource(Option.some({from: tick, speed: 0}))
					Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
				},
				selected: Option.flatMap(panel, selection => Option.map(selection.entry, entry => entry.id))
			}}
		>
			<Portraits
				value={{
					images: portraits,
					request: Option.getOrElse(
						Option.map(world, active => active.cast.requestPortrait),
						() => () => undefined
					)
				}}
			>
				<Membership
					value={Record.fromEntries([
						...Array.map(props.view.frame.units, unit => [`${unit.id}`, {kind: unit.kind, team: unit.team}] as const),
						...Array.map(
							props.view.buildings,
							building => [`${building.id}`, {kind: building.kind, team: building.team}] as const
						)
					])}
				>
					<div className="absolute inset-0 flex flex-col">
						<div className="relative min-h-0 flex-1">
							<canvas
								ref={canvas}
								aria-label="Signal"
								tabIndex={0}
								className="absolute inset-0 size-full touch-none"
								onPointerDown={gestures.down}
								onPointerUp={gestures.up}
								onPointerMove={gestures.move}
								onPointerCancel={gestures.cancel}
								onLostPointerCapture={gestures.lost}
								onPointerLeave={gestures.leave}
								onWheel={gestures.wheel}
							/>
							<DrawingWorld />
							<Overlay buildings={props.view.buildings} inspection={panel} units={props.view.frame.units} />
							<MapControls
								onTeam={next => {
									navigate({search: teamSearch(next)})
									setFollow({free: Option.none(), id: Option.none()})
									setPanel(before =>
										Option.map(before, () => ({actor: Option.none(), entry: Option.none(), scoped: false}))
									)
									Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
								}}
								view={props.view}
							/>
							<ReplayLoading />
							<SpectatorControls
								coverage={Array.isReadonlyArrayNonEmpty(props.view.zones)}
								source={source}
								tick={cursor}
								threadOpen={Option.exists(panel, selection => !selection.scoped)}
								onCentre={() => {
									// Recenter returns to what is selected, or the team's Core when the view stands alone.
									const subject = Option.flatMap(panel, selection =>
										Option.orElse(selection.actor, () =>
											Option.flatMap(selection.entry, entry => Option.fromUndefinedOr(entry.subject))
										)
									)
									setFollow({free: Option.none(), id: subject})
									Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
								}}
								onLive={() => setSource(Option.none())}
								onThreads={() =>
									setPanel(before =>
										Option.match(before, {
											onNone: () => Option.some({actor: Option.none(), entry: Option.none(), scoped: false}),
											onSome: selection =>
												Boolean.match(selection.scoped, {
													onFalse: () => Option.none(),
													onTrue: () => Option.some({actor: Option.none(), entry: Option.none(), scoped: false})
												})
										})
									)
								}
							/>
							{Option.getOrUndefined(
								Option.map(panel, pickedPanel => (
									<Sidebar
										selection={pickedPanel}
										clear={() => setPanel(Option.some({actor: Option.none(), entry: Option.none(), scoped: false}))}
										close={() => setPanel(Option.none())}
										view={props.view}
										source={source}
									/>
								))
							)}
						</div>
					</div>
				</Membership>
			</Portraits>
		</Navigation>
	)
}

function Signal() {
	const result = useAtomValue(hudAtom)
	const seed = useAtomValue(seedAtom)
	const retry = useAtomRefresh(viewAtom)
	return (
		<main className="relative min-h-0 flex-1 overflow-hidden text-sm select-none">
			{Option.getOrUndefined(
				Option.map(
					Option.flatMap(AsyncResult.value(result), view => Option.fromUndefinedOr(view.frame.problem)),
					text => (
						<Status tone="warning" icon={<WarningIcon className="size-4 shrink-0" />}>
							{text}
						</Status>
					)
				)
			)}
			{/* The world stays on screen while its stream starts over, as a replay begins or ends. */}
			{Option.match(seed, {
				onNone: () =>
					Option.match(
						Option.filter(AsyncResult.error(result), () => AsyncResult.isFailure(result)),
						{
							onNone: () => (
								<div className="absolute inset-0 flex">
									<Empty role="status" aria-label="Connecting to Signal">
										<EmptyHeader>
											<EmptyMedia>
												<img src={icon} alt="" className="pixelated size-10 opacity-90" />
											</EmptyMedia>
											<h2 className="font-heading text-3xl leading-none tracking-tight">Connecting to the world</h2>
											<EmptyDescription>
												<span className="inline-flex items-center gap-2">
													<Spinner className="size-3" />
													The stream is starting.
												</span>
											</EmptyDescription>
										</EmptyHeader>
									</Empty>
								</div>
							),
							onSome: failure =>
								Boolean.match(needsSignIn(failure), {
									onFalse: () => (
										<div className="absolute inset-0 flex flex-col">
											<Error error={failure} label="Signal is unavailable" reset={retry} />
										</div>
									),
									onTrue: () => <SignIn href={signInUrl(location.href)} />
								})
						}
					),
				onSome: known => (
					<>
						<World seed={known} view={Option.getOrElse(AsyncResult.value(result), () => EMPTY)} />
						{Option.getOrUndefined(
							Option.map(AsyncResult.error(result), failure =>
								Boolean.match(needsSignIn(failure), {
									onFalse: () => (
										<Status tone="warning" icon={<WifiSlashIcon className="size-4 shrink-0" />}>
											World stream interrupted
										</Status>
									),
									onTrue: () => <SignIn href={signInUrl(location.href)} />
								})
							)
						)}
					</>
				)
			})}
		</main>
	)
}

export const Route = createFileRoute('/(home)/')({component: Signal, validateSearch: WebRuntime.searchOf(Search)})
