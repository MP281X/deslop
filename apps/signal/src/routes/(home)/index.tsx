import {RegistryContext, useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Number, Option, Predicate, Record, Schema, String, Struct} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {
	AlertTriangle,
	ArrowUpRight,
	ChevronDown,
	Grid2X2,
	Bot,
	Eye,
	MessagesSquare,
	Pause,
	Radio,
	WifiOff,
	X
} from 'lucide-react'
import type {PointerEvent, ReactNode, WheelEvent} from 'react'
import {createContext, useContext, useEffect, useRef, useState} from 'react'

import {GitHubIcon} from '@deslop/components-web/icons'
import {Button} from '@deslop/components-web/ui/button'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {cn} from '@deslop/components-web/utils'
import {signInUrl} from '@deslop/runtime/auth/utils'

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
	sourceAtom,
	teamAtom,
	usageAtom,
	viewAtom
} from '#lib/utils.ts'
import type {Follow, Source, View} from '#lib/utils.ts'
import {TEAMS, TICK_HZ} from '#services/game/lib/utils.ts'
import type {BuildingView, Entry, Experience, LocalDecision, TeamView, UnitView} from '#services/game/schema.ts'
import {UnitKind} from '#services/game/schema.ts'
import {tileOf} from '#services/world/lib/utils.ts'

const ZOOM_STEP = 1.25
const groundAtom = Atom.make({at: Option.none<{x: number; z: number}>(), info: Option.none<Inspected>(), x: 0, y: 0})
const chunksAtom = Atom.make(true)
const USAGE_MODE = Boolean.match(import.meta.env.DEV, {onFalse: () => 'production', onTrue: () => 'development'})

type Key = 'in' | 'leave' | 'next' | 'out' | 'previous'
type Inspection = {actor: Option.Option<number>; entry: Option.Option<Experience>; scoped: boolean}

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

function teamName(team: number) {
	if (team === -1) return 'All models'
	return TEAMS[team]?.name ?? `Team ${team}`
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

function EntityReference(props: {id: number; tick: number; kind?: string; fallback?: {x: number; z: number}}) {
	const navigate = useContext(Navigation)

	const member = useContext(Membership)[props.id]
	const kind = props.kind ?? member?.kind
	return (
		<Button
			variant="link"
			title={Option.match(Option.fromUndefinedOr(kind), {
				onNone: () => `Recorded entity #${props.id}`,
				onSome: name => actorName(name, props.id)
			})}
			className="text-foreground pointer-events-auto inline-flex h-auto items-center gap-1 p-0 align-middle whitespace-normal underline decoration-dotted underline-offset-4"
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
			{Option.match(Option.fromUndefinedOr(kind), {
				onNone: () => 'Recorded entity',
				onSome: name => Boolean.match(name === 'home', {onFalse: () => fieldName(name), onTrue: () => 'Core'})
			})}
		</Button>
	)
}

function References(props: {text: string; tick: number}) {
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
							<Button
								variant="link"
								key={index}
								className="pointer-events-auto h-auto p-0 underline decoration-dotted underline-offset-4"
								onClick={() =>
									navigate.place(
										Option.getOrElse(Number.parse(found[1] ?? ''), () => 0),
										Option.getOrElse(Number.parse(found[2] ?? ''), () => 0),
										props.tick
									)
								}
							>
								this location
							</Button>
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
			className={cn('inline-block size-2 flex-none bg-(--team)', props.className)}
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
			<span className="text-muted-foreground min-w-12 text-right whitespace-nowrap tabular-nums">{props.value}</span>
		</span>
	)
}

function Panel(props: {children: ReactNode; className?: string; label?: string}) {
	return (
		<section
			aria-label={props.label}
			className={cn('bg-popover text-popover-foreground absolute border', props.className)}
		>
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
		onSome: found => (
			<li className="bg-muted/60 px-3 py-2 leading-relaxed">
				<span className="mb-1 flex items-center gap-1.5">
					<Swatch team={Option.getOrElse(Number.parse(found[1] ?? ''), () => 0)} />
					{teamName(Option.getOrElse(Number.parse(found[1] ?? ''), () => 0))}
				</span>
				<References text={found[2] ?? ''} tick={props.tick} />
			</li>
		)
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
			<ul className="space-y-1">
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
							<dt className={cn('text-muted-foreground', Predicate.isObject(field[1]) && 'col-span-3')}>
								{fieldName(field[0])}
							</dt>
							<dd className={cn('col-span-2 min-w-0 break-words', Predicate.isObject(field[1]) && 'col-span-3')}>
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
		if (props.field === 'tick') return <time>{clockOf(props.value)}</time>
		if (props.field === 'health') return <span>{percent(props.value)}</span>
		if (entityField(props.field ?? '')) {
			return <References text={`#${props.value}`} tick={props.tick} />
		}
		return <span>{props.value.toLocaleString('en')}</span>
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

function RecordDetails(props: {children: ReactNode; title: ReactNode; compact?: boolean}) {
	const [open, setOpen] = useState(false)
	return (
		<details
			className={cn('text-xs', props.compact !== true && 'relative mt-1')}
			onToggle={event => setOpen(event.currentTarget.open)}
		>
			<summary
				className={cn(
					'text-muted-foreground cursor-pointer',
					props.compact &&
						'absolute top-0 right-0 z-10 flex size-11 list-none items-center justify-center [&::-webkit-details-marker]:hidden'
				)}
			>
				{Boolean.match(props.compact === true, {
					onFalse: () => props.title,
					onTrue: () => (
						<>
							<ChevronDown className={cn('size-4', open && 'rotate-180')} />
							<span className="sr-only">{props.title}</span>
						</>
					)
				})}
			</summary>
			{open && <div className="space-y-3 py-2">{props.children}</div>}
		</details>
	)
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
			<div className="space-y-3">
				{Record.isEmptyRecord(state) && <StructuredText text={props.request.state} tick={props.request.tick} />}
				{Record.has(state, 'self') && (
					<div>
						<p className="text-muted-foreground mb-1">At decision · {clockOf(props.request.tick)}</p>
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
						<p className="text-muted-foreground mb-1">Guidance</p>
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
					<p className="text-muted-foreground mb-1 text-xs">Available choices</p>
					<ul className="space-y-2">
						{Array.map(Record.toEntries(props.request.choices), choice => (
							<li key={choice[0]} className="leading-relaxed">
								<References text={choice[1]} tick={props.request.tick} />
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
			<div>
				<p className="text-muted-foreground">Original text · older request format</p>
				<StructuredText text={props.text} tick={props.tick} />
			</div>
		),
		onSome: request => <DecisionRequest request={request} />
	})
}

function RequestDetails(props: {entry: Experience}) {
	if (props.entry.context === undefined) {
		return (
			<RecordDetails title="Complete event">
				<StructuredText text={eventText(props.entry)} tick={props.entry.tick} />
			</RecordDetails>
		)
	}
	return <OriginalRequest text={props.entry.context} tick={props.entry.tick} />
}

function Outcome(props: {outcome: Entry['commands'][number]; tick: number}) {
	const navigate = useContext(Navigation)
	return (
		<li>
			<details>
				<summary className={cn('cursor-pointer py-1', !props.outcome.ok && 'text-destructive')}>
					{Boolean.match(props.outcome.ok, {onFalse: () => '✕', onTrue: () => '✓'})} {props.outcome.command._tag}
				</summary>
				<div className="py-2 text-xs">
					<DataValue value={argumentsOf(props.outcome.command)} tick={props.tick} />
				</div>
				{Option.getOrUndefined(
					Option.map(commandPlace(props.outcome.command), at => (
						<Button
							variant="link"
							className="underline underline-offset-4"
							onClick={() => navigate.place(at.x, at.z, props.tick)}
						>
							{props.outcome.command._tag} here
						</Button>
					))
				)}
				<div className="pb-2 leading-relaxed break-words">
					<StructuredText text={props.outcome.text} tick={props.tick} />
				</div>
			</details>
		</li>
	)
}
// One round of a team's thread: when, what it was told, what it thought and said, and what each command did.
function Round(props: {entry: Entry}) {
	const navigate = useContext(Navigation)
	const summary = roundSummary(props.entry)
	return (
		<li className="relative border-t py-2 [&:has(>details[open])_[data-preview]]:hidden">
			<div className="relative flex items-start gap-2 pr-10">
				<Button
					variant="ghost"
					className="absolute inset-0 h-full w-full"
					aria-label={`${teamName(props.entry.team)} Core at ${clockOf(props.entry.tick)}`}
					onClick={() => navigate.core(props.entry.team, props.entry.tick)}
				>
					<span className="sr-only">View this message in the world</span>
				</Button>
				<Portrait kind={`home:${props.entry.team}`} className="pointer-events-none relative size-9" />
				<div className="pointer-events-none relative min-w-0 flex-1">
					<header className="flex items-baseline justify-between gap-2 text-xs">
						<span className="text-(--team)" style={{'--team': teamColor(props.entry.team)}}>
							{teamName(props.entry.team)} Core
						</span>
						<time className="text-muted-foreground shrink-0 font-mono">{clockOf(props.entry.tick)}</time>
					</header>
					{props.entry.status !== 'done' && <span className="text-destructive text-xs">{props.entry.status}</span>}
					{(summary.failed > 0 || summary.unreadable > 0) && (
						<p className="text-destructive flex flex-wrap items-center gap-1 text-xs">
							<AlertTriangle className="size-3" />
							{summary.failed > 0 && <span>Failed commands: {summary.failed}</span>}
							{summary.unreadable > 0 && <span>Unreadable calls: {summary.unreadable}</span>}
						</p>
					)}
					{String.isNonEmpty(String.trim(props.entry.text)) && (
						<div data-preview className="line-clamp-2 leading-relaxed">
							<References text={summary.text} tick={props.entry.tick} />
						</div>
					)}
				</div>
			</div>
			<RecordDetails compact title="Core details">
				<StructuredText text={props.entry.text} tick={props.entry.tick} />
				{Array.isReadonlyArrayNonEmpty(props.entry.notices) && (
					<details>
						<summary className="text-muted-foreground cursor-pointer text-xs">Received updates</summary>
						<ul className="flex flex-col gap-1 py-2">
							{Array.map(props.entry.notices, (notice, index) => (
								<Notice key={index} text={notice} tick={props.entry.observed ?? props.entry.tick} />
							))}
						</ul>
					</details>
				)}
				{Option.getOrUndefined(
					Option.map(Option.filter(Option.fromUndefinedOr(props.entry.reasoning), String.isNonEmpty), reasoning => (
						<details>
							<summary className="text-muted-foreground cursor-pointer">Reasoning</summary>
							<p className="text-muted-foreground mt-2 leading-relaxed whitespace-pre-wrap">
								<References text={String.trim(reasoning)} tick={props.entry.tick} />
							</p>
						</details>
					))
				)}
				{Array.isReadonlyArrayNonEmpty(props.entry.commands) && (
					<ul className="flex flex-col gap-1">
						{Array.map(props.entry.commands, (outcome, index) => (
							<Outcome key={index} outcome={outcome} tick={props.entry.tick} />
						))}
					</ul>
				)}
				<details>
					<summary className="text-muted-foreground cursor-pointer">
						Original observation · active request may be abbreviated
					</summary>
					<div className="mt-2 text-xs">
						<StructuredText text={props.entry.observation} tick={props.entry.observed ?? props.entry.tick} />
					</div>
				</details>
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
	return (
		<li
			aria-current={Option.contains(navigate.selected, props.entry.id)}
			className={cn('relative border-t py-2', Option.contains(navigate.selected, props.entry.id) && 'bg-muted/50')}
		>
			<div className="relative flex items-start gap-2 pr-10">
				<Button
					variant="ghost"
					className="absolute inset-0 h-full w-full"
					aria-label={`${actorName(kind, props.entry.actor)} · ${props.entry.kind} at ${clockOf(props.entry.tick)}`}
					onClick={() => navigate.event(props.entry)}
				>
					<span className="sr-only">View this event in the world</span>
				</Button>
				<Portrait
					kind={Boolean.match(kind === 'home' && team !== undefined, {
						onFalse: () => kind,
						onTrue: () => `home:${team}`
					})}
					className="pointer-events-none relative size-9"
				/>
				<div className="pointer-events-none relative min-w-0 flex-1">
					<header className="flex items-baseline justify-between gap-2 text-xs">
						<span className="text-(--team)" style={{'--team': teamColor(team ?? -1)}}>
							{actorName(kind, props.entry.actor)}
						</span>
						<time className="text-muted-foreground shrink-0 font-mono">{clockOf(props.entry.tick)}</time>
					</header>
					<div className="line-clamp-2 leading-relaxed break-words">
						<References text={eventSummary(props.entry)} tick={props.entry.tick} />
					</div>
				</div>
			</div>
			<Button
				variant="ghost"
				size="icon"
				className="absolute top-1 right-0 min-h-11 min-w-9"
				aria-label={`Inspect ${actorName(kind, props.entry.actor)} at ${clockOf(props.entry.tick)}`}
				onClick={() => navigate.event(props.entry)}
			>
				<ArrowUpRight className="size-3" />
			</Button>
		</li>
	)
}

function Observations(props: {entries: readonly Experience[]}) {
	return (
		<li className="border-t py-2">
			<RecordDetails
				title={
					<span className="inline-flex items-center gap-2">
						<Eye className="size-3" />
						{props.entries.length} observations<time className="font-mono">{clockOf(props.entries[0]?.tick ?? 0)}</time>
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
	const result = useAtomValue(
		Boolean.match(props.before === undefined && Option.isNone(expanded), {
			onFalse: () => feedAtom(before),
			onTrue: () => threadFeedAtom
		})
	)
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
								<li>
									<Button
										variant="ghost"
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
										Earlier records
									</Button>
								</li>
							)
						)
					),
				onSome: page => (
					<>
						{props.before === undefined && (
							<li>
								<Button
									variant="ghost"
									onClick={() => {
										setExpanded(Option.none())
										props.onLatest()
									}}
								>
									Latest records
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
			{AsyncResult.isFailure(result) && <li role="alert">Decisions could not be read.</li>}
			{Array.isReadonlyArrayEmpty(entries) && !AsyncResult.isFailure(result) && (
				<li className="text-muted-foreground py-3">
					{Boolean.match(AsyncResult.isInitial(result), {
						onFalse: () => 'No decisions in this part of the recording.',
						onTrue: () => 'Loading…'
					})}
				</li>
			)}
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

function WorldConfiguration() {
	const notices = useAtomValue(configurationAtom)
	if (Array.isReadonlyArrayEmpty(notices)) return null
	return (
		<div role="status" className="text-warning px-3 pb-2 text-xs">
			{Array.join(
				Array.map(notices, notice => String.split(' · ')(notice)[0] ?? notice),
				' · '
			)}
		</div>
	)
}

function Thread(props: {status?: TeamView['status']; team: number}) {
	const list = useRef<HTMLOListElement>(null)
	const pinned = useRef(true)
	useEffect(() => {
		if (pinned.current) list.current?.scrollTo({top: list.current.scrollHeight})
	})
	return (
		<ol
			ref={list}
			onScroll={event => {
				pinned.current =
					event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24
			}}
			className="flex min-h-0 flex-col overflow-y-auto overscroll-contain px-3 pb-3 select-text"
		>
			<ThreadPage
				team={props.team}
				onEarlier={() => {
					pinned.current = false
				}}
				onLatest={() => {
					pinned.current = true
				}}
				onRead={() => {
					if (pinned.current) list.current?.scrollTo({top: list.current.scrollHeight})
				}}
			/>
			{props.status === 'thinking' && (
				<li className="text-muted-foreground flex items-center gap-2 py-3">
					<Spinner className="size-3" />
					Thinking
				</li>
			)}
		</ol>
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
	const result = useAtomValue(
		historyAtom(
			`${props.actor}:${Option.getOrElse(
				Option.map(expanded, page => page.upper),
				() => props.before ?? 0
			)}`
		)
	)
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
								<li>
									<Button
										variant="ghost"
										onClick={() => {
											props.onEarlier()
											setExpanded(Option.some({before: first.id, upper: Option.getOrThrow(Array.last(entries)).id + 1}))
										}}
									>
										Earlier events
									</Button>
								</li>
							)
						)
					),
				onSome: page => (
					<>
						{props.before === undefined && (
							<li>
								<Button
									variant="ghost"
									onClick={() => {
										setExpanded(Option.none())
										props.onLatest()
									}}
								>
									Latest events
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
			{AsyncResult.isFailure(result) && <li role="alert">History could not be read.</li>}
			{Array.isReadonlyArrayEmpty(entries) && !AsyncResult.isFailure(result) && (
				<li className="text-muted-foreground py-3">
					{Boolean.match(AsyncResult.isInitial(result), {
						onFalse: () => 'No recording here yet.',
						onTrue: () => 'Loading history…'
					})}
				</li>
			)}
			{Array.map(Record.values(Array.groupBy(entries, entry => `${entry.actor}:${entry.tick}`)), entriesInTick => (
				<HistoryGroup key={Option.getOrThrow(Array.head(entriesInTick)).id} entries={entriesInTick} />
			))}
		</>
	)
}

function Chronicle(props: {actor: number}) {
	const list = useRef<HTMLDivElement>(null)
	const pinned = useRef(true)
	return (
		<div
			ref={list}
			onScroll={event => {
				pinned.current =
					event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24
			}}
			aria-label="Private individual history"
			className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 select-text"
		>
			<ol className="flex flex-col gap-4">
				<HistoryPage
					actor={props.actor}
					onEarlier={() => {
						pinned.current = false
					}}
					onLatest={() => {
						pinned.current = true
					}}
					onRead={() => {
						if (pinned.current) list.current?.scrollTo({top: list.current.scrollHeight})
					}}
				/>
			</ol>
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
	const filter = useAtomValue(teamAtom)
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
					'bg-popover text-popover-foreground pointer-events-auto flex max-h-1/2 min-h-0 w-full flex-col md:max-h-full md:w-80',
					actor !== undefined && 'max-h-2/3 lg:w-160'
				)}
			>
				<header className="border-border flex min-h-11 flex-none items-center gap-2 border-b px-3">
					<MessagesSquare className="size-4" />
					<span>
						{Option.match(scopedActor, {onNone: () => 'Thread', onSome: id => `${actorName(kind, id)} history`})}
					</span>
					<Button
						className="ml-auto min-h-11 min-w-11"
						size="icon-sm"
						aria-label="Close inspector"
						variant="ghost"
						onClick={props.close}
					>
						<X className="size-4" />
					</Button>
				</header>
				<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
					<div className="flex min-h-28 min-w-0 flex-1 flex-col">
						<WorldConfiguration />
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
								'flex max-h-60 min-h-0 shrink-0 flex-col border-t lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l',
								selected !== undefined && 'h-56 lg:h-auto'
							)}
						>
							<header className="flex min-h-11 shrink-0 items-center gap-2 px-3">
								<Portrait kind={kind} className="size-7" />
								<span>{actorName(kind, actor)}</span>
								{selected !== undefined && (
									<time className="text-muted-foreground text-xs">{clockOf(selected.tick)}</time>
								)}
								<Button
									variant="ghost"
									size="icon"
									className="ml-auto min-h-11 min-w-9"
									onClick={props.clear}
									aria-label="Clear entity selection"
								>
									<X className="size-3" />
								</Button>
							</header>
							<div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 text-xs select-text">
								{Option.getOrUndefined(
									Option.map(
										Option.filter(unit, () => selected?.context === undefined),
										current => <Followed unit={current} />
									)
								)}
								{Option.match(props.selection.entry, {
									onNone: () => (
										<p className="text-muted-foreground">
											Select a decision in the thread to inspect its perception and choices.
										</p>
									),
									onSome: entry => <RequestDetails entry={entry} />
								})}
							</div>
						</section>
					)}
				</div>
			</aside>
		</div>
	)
}

function SpectatorControls(props: {source: Source; tick: number; onLive: () => void; onThreads: () => void}) {
	const [chunks, setChunks] = useAtom(chunksAtom)
	const live = Option.isNone(props.source)
	const status = useAtomValue(runStateAtom)
	const run = Option.getOrUndefined(AsyncResult.value(status))
	return (
		<section
			aria-label="Spectator controls"
			className="absolute inset-x-2 bottom-2 z-30 flex items-end justify-between gap-2 md:inset-x-4 md:bottom-4"
		>
			<div className="bg-popover flex shrink-0 rounded-md">
				<Button
					variant="ghost"
					size="sm"
					className={cn('min-h-11 min-w-11 px-1', chunks && 'text-primary')}
					aria-label="Team chunks"
					aria-pressed={chunks}
					title={Boolean.match(chunks, {onFalse: () => 'Show team chunks', onTrue: () => 'Hide team chunks'})}
					onClick={() => setChunks(shown => !shown)}
				>
					<Grid2X2 className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="min-h-11 min-w-11"
					aria-label="Threads"
					onClick={props.onThreads}
				>
					<MessagesSquare className="size-4" />
				</Button>
			</div>
			<Button
				variant="secondary"
				className="bg-popover h-11 min-w-0 items-center gap-2 px-2 leading-none"
				aria-label={Boolean.match(live, {onFalse: () => 'Return to live', onTrue: () => 'Latest world view'})}
				onClick={props.onLive}
			>
				{!live && (
					<time className="text-muted-foreground font-mono text-xs">
						{String.replace(/^0:/u, '')(clockOf(props.tick))}
					</time>
				)}
				<span
					className={cn(
						'text-primary flex h-full items-center leading-none',
						live && run?.running !== true && 'text-muted-foreground'
					)}
				>
					{Boolean.match(live, {
						onFalse: () => (
							<span className="flex items-center gap-1 leading-none">
								<Radio className="size-4" />
								Live
								<ArrowUpRight className="size-3" />
							</span>
						),
						onTrue: () =>
							Boolean.match(AsyncResult.isFailure(status), {
								onFalse: () => (
									<span className="flex items-center gap-1.5 leading-none">
										{Boolean.match(run?.running === true, {
											onFalse: () => (
												<>
													<Pause className="size-4" />
													Paused
												</>
											),
											onTrue: () => (
												<>
													<Radio className="size-4" />
													Live
												</>
											)
										})}
									</span>
								),
								onTrue: () => <WifiOff className="size-4" aria-label="Disconnected" />
							})
					})}
				</span>
			</Button>
		</section>
	)
}

// The hover card: the portrait beside what the unit or creature is doing, with its health.
function Card(props: {unit: UnitView}) {
	return (
		<div className="bg-popover text-popover-foreground absolute bottom-7 left-0 flex w-60 -translate-x-1/2 items-center gap-3 border p-2.5">
			<Portrait kind={props.unit.kind} className="size-10" />
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
		<div className="bg-popover text-popover-foreground absolute bottom-4 left-0 w-max max-w-60 -translate-x-1/2 px-2 py-1.5">
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
							<span className="text-muted-foreground">
								{field.left.toLocaleString('en', {maximumFractionDigits: 1, notation: 'compact'})} left
							</span>
						</p>
					)
				)
			)}
		</div>
	)
}

function Status(props: {children: ReactNode}) {
	return (
		<Panel className="right-4 bottom-4 left-4 z-50 mx-auto w-fit max-w-full px-3 py-2">
			<p role="status" className="text-muted-foreground">
				{props.children}
			</p>
		</Panel>
	)
}

function SignIn() {
	return (
		<Panel label="Sign in" className="top-1/2 left-1/2 w-80 -translate-1/2">
			<p className="p-3 font-medium">Signal</p>
			<p className="text-muted-foreground px-3 pb-3 leading-relaxed">
				Independent AI teams build, explore and encounter one another in an evolving world. You watch.
			</p>
			<div className="border-t p-3">
				<Button
					className="w-full"
					size="lg"
					nativeButton={false}
					render={<a aria-label="Sign in with GitHub" href={signInUrl(location.href)} />}
				>
					<GitHubIcon />
					Sign in with GitHub
				</Button>
			</div>
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

// The world view and everything over it: the canvas belongs to the renderer, and frames reach it through the registry, not React.
function Spend() {
	return Option.getOrUndefined(
		Option.map(
			Option.filter(
				Option.map(AsyncResult.value(useAtomValue(usageAtom)), ledger => spendOf(ledger, USAGE_MODE)),
				total => total.reported > 0
			),
			total => (
				<details className="relative shrink-0" aria-label="Total model spend">
					<summary
						className="bg-popover flex min-h-11 cursor-pointer list-none items-center rounded-md px-2 text-xs tabular-nums [&::-webkit-details-marker]:hidden"
						title="Total reported model spend"
					>
						${total.cost.toLocaleString('en', {maximumFractionDigits: 4, minimumFractionDigits: 2})}
					</summary>
					<div className="bg-popover absolute top-12 right-0 w-64 space-y-2 border p-3 text-xs">
						<p className="font-medium">{fieldName(USAGE_MODE)} · reported spend</p>
						<div className="flex h-2 gap-px overflow-hidden rounded-sm" aria-label="Cost by model">
							{Array.map(
								total.models,
								(model, index) =>
									model.cost > 0 && (
										<span
											key={model.model}
											className="bg-foreground flex-(--share) opacity-(--strength)"
											style={{
												'--share': (model.cost / total.cost) * 100,
												'--strength': Number.max(0.25, 1 - index * 0.2)
											}}
											title={model.model}
										/>
									)
							)}
						</div>
						{Array.map(
							total.models,
							model =>
								model.reported > 0 && (
									<div key={model.model} className="flex items-center justify-between gap-2">
										<span className="truncate">{model.model}</span>
										<span className="tabular-nums">${model.cost.toLocaleString('en', {maximumFractionDigits: 4})}</span>
									</div>
								)
						)}
						{total.reported < total.calls && (
							<p className="text-muted-foreground">
								Cost reported for {total.reported} of {total.calls} requests. Unreported costs aren’t included.
							</p>
						)}
					</div>
				</details>
			)
		)
	)
}

function MapControls(props: {view: View; onTeam: (team: number) => void}) {
	const team = useAtomValue(teamAtom)
	return (
		<nav
			className="absolute inset-x-2 top-2 z-30 flex items-start justify-between gap-2 md:inset-x-4 md:top-4"
			aria-label="Map controls"
		>
			<div className="flex min-w-0 gap-1 overflow-x-auto" aria-label="Teams">
				<Button
					aria-label="All models"
					aria-pressed={team === -1}
					title="All models"
					variant="secondary"
					className={cn('bg-popover min-h-11 min-w-11 px-2', team === -1 && 'border-foreground/40')}
					onClick={() => props.onTeam(-1)}
				>
					<Bot className="size-5" />
				</Button>
				{Array.map(props.view.teams, entry => (
					<Button
						key={entry.id}
						aria-label={entry.name}
						aria-pressed={team === entry.id}
						title={entry.name}
						variant="secondary"
						size="sm"
						className={cn(
							'bg-popover min-h-11 min-w-11 shrink-0 px-2 text-(--team) hover:text-(--team)',
							team === entry.id && 'border-(--team)/60'
						)}
						style={{'--team': teamColor(entry.id)}}
						onClick={() => props.onTeam(entry.id)}
					>
						<TeamIcon team={entry.id} className="size-5" />
					</Button>
				))}
			</div>
			<Spend />
		</nav>
	)
}

function ReplayLoading() {
	const loading = useAtomValue(loadingAtom)
	const source = useAtomValue(sourceAtom)
	if (!loading) return null
	return <Status>{Option.match(source, {onNone: () => 'Rejoining live', onSome: () => 'Loading history'})}</Status>
}

function World(props: {seed: number; view: View}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [world, setWorld] = useState(Option.none<{cast: Cast; renderer: Renderer}>)
	// The tile under the pointer, what the chunk worker said lies on it, and the pointer's place on screen.
	const setGround = useAtomSet(groundAtom)
	const setFollow = useAtomSet(followAtom)
	const setTeam = useAtomSet(teamAtom)
	const [source, setSource] = useAtom(sourceAtom)
	const [panel, setPanel] = useState(Option.none<Inspection>)
	const cursor = useAtomValue(cursorAtom)

	const [portraits, setPortraits] = useState<Record<string, string>>({})
	// What the key handler and the camera read, kept current outside render.
	const latest = useRef({view: props.view})
	useEffect(() => {
		latest.current = {view: props.view}
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.invalidate()})
	}, [props.view, world])

	useEffect(() => {
		const target = canvas.current
		if (target === null) return
		target.addEventListener('wheel', preventMapWheel, {passive: false})
		const renderer = createRenderer(target, props.seed)
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
		const teamChanged = registry.subscribe(teamAtom, renderer.invalidate)
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
			renderer.aim(aimOf(current, registry.get(teamAtom), latest.current.view, active))
			renderer.focus(Option.flatMap(current.id, cast.objectOf), teamColor(registry.get(teamAtom)))
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
			const own = unitsOf(latest.current.view.frame.units, registry.get(teamAtom))
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
			registry.set(teamAtom, next)
			registry.set(followAtom, {free: Option.none(), id: Option.none()})
			renderer.centre()
		}
		const actions = {
			in: () => renderer.zoomBy(1 / ZOOM_STEP),
			leave,
			next: () => cycle(1),
			out: () => renderer.zoomBy(ZOOM_STEP),
			previous: () => cycle(-1)
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
			teamChanged()
			runChanged()
			sourceChanged()
			hoverChanged()
			groundChanged()
			cast.dispose()
			renderer.dispose()
		}
	}, [registry, props.seed, setGround])

	function followUnit(id: number) {
		const unit = Option.getOrUndefined(Array.findFirst(props.view.frame.units, entry => entry.id === id))
		if (unit?.team !== undefined) setTeam(unit.team)
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
				core: (team, tick) => {
					Option.match(
						Array.findFirst(props.view.teams, entry => entry.id === team),
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
							<Overlay buildings={props.view.buildings} inspection={panel} units={props.view.frame.units} />
							<MapControls
								onTeam={team => {
									setTeam(team)
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
								source={source}
								tick={cursor}
								onLive={() => setSource(Option.none())}
								onThreads={() =>
									setPanel(before =>
										Option.some(
											Option.match(before, {
												onNone: () => ({actor: Option.none(), entry: Option.none(), scoped: false}),
												onSome: selection => ({...selection, scoped: false})
											})
										)
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
	return (
		<main className="relative min-h-0 flex-1 overflow-hidden text-sm select-none">
			{Option.getOrUndefined(
				Option.map(
					Option.flatMap(AsyncResult.value(result), view => Option.fromUndefinedOr(view.frame.problem)),
					text => <Status>{text}</Status>
				)
			)}
			{/* The world stays on screen while its stream starts over, as a replay begins or ends. */}
			{Option.match(useAtomValue(seedAtom), {
				onNone: () =>
					Option.match(
						Option.filter(AsyncResult.error(result), () => AsyncResult.isFailure(result)),
						{
							onNone: () => <Status>Connecting</Status>,
							onSome: error =>
								Boolean.match(error._tag === 'AuthError', {
									onFalse: () => <Status>Reconnecting</Status>,
									onTrue: () => <SignIn />
								})
						}
					),
				onSome: known => (
					<>
						<World seed={known} view={Option.getOrElse(AsyncResult.value(result), () => EMPTY)} />
						{Option.getOrUndefined(Option.map(AsyncResult.error(result), error => <Status>{error.message}</Status>))}
					</>
				)
			})}
		</main>
	)
}

export const Route = createFileRoute('/(home)/')({component: Signal})
