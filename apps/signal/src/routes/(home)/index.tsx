import {RegistryContext, useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, Predicate, Record, String, Struct, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {PointerEvent, ReactNode, WheelEvent} from 'react'
import {createContext, useContext, useEffect, useRef, useState} from 'react'

import {GitHubIcon} from '@deslop/components-web/icons'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {cn} from '@deslop/components-web/utils'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {createCast} from './-cast.ts'
import type {Cast} from './-cast.ts'
import type {Inspected} from './-chunks.worker.ts'
import {createRenderer} from './-renderer.ts'
import type {Renderer} from './-renderer.ts'

import {
	EMPTY,
	feedAtom,
	controlAtom,
	followAtom,
	hoverAtom,
	historyAtom,
	hudAtom,
	loadingAtom,
	runStateAtom,
	seedAtom,
	sourceAtom,
	teamAtom,
	timelineAtom,
	viewAtom
} from '#lib/utils.ts'
import type {Follow, Source, View} from '#lib/utils.ts'
import {TEAMS, TICK_HZ} from '#services/game/lib/utils.ts'
import type {BuildingView, Entry, Experience, Mark, TeamView, Timeline, UnitView} from '#services/game/schema.ts'
import {UnitKind} from '#services/game/schema.ts'
import {tileOf} from '#services/world/lib/utils.ts'

const ZOOM_STEP = 1.25
// The replay speeds, in multiples of real time.
const SPEEDS = [1, 10, 30]
const coverageAtom = Atom.make(-1)
const groundAtom = Atom.make({at: Option.none<{x: number; z: number}>(), info: Option.none<Inspected>(), x: 0, y: 0})

type Key = 'in' | 'leave' | 'next' | 'out' | 'overview' | 'play' | 'previous'
type Inspection = {kind: 'thread'} | {actor: Option.Option<number>; kind: 'history'}

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
	return `${Math.floor(seconds / 3600)}:${pad(`${Math.floor(seconds / 60) % 60}`)}:${pad(`${seconds % 60}`)}`
}

function teamColor(team: number) {
	return TEAMS[team]?.color ?? '#888888'
}

function teamName(team: number) {
	if (team === -1) return 'All teams'
	return TEAMS[team]?.name ?? `Team ${team}`
}

// A team's units, in a stable order: by class, then by id.
function unitsOf(units: View['frame']['units'], team: number) {
	return Array.sortWith(
		Array.filter(units, unit => unit.team === team && isUnit(unit.kind)),
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

function letterKey(code: string, repeat: boolean) {
	if (repeat) return Option.none<Key>()
	if (code === 'KeyQ') return Option.some<Key>('overview')
	if (code === 'Space') return Option.some<Key>('play')
	return Option.none<Key>()
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
	return Option.orElse(letterKey(event.code, event.repeat), () => symbolKey(event.key))
}

// Each model's portrait, painted by the cast as the models load.
const Portraits = createContext<Record<string, string>>({})
const Membership = createContext<Record<string, number>>({})

const Navigation = createContext<{
	entity: (id: number, tick: number) => void
	place: (x: number, z: number, tick: number) => void
	time: (tick: number) => void
}>({entity: () => undefined, place: () => undefined, time: () => undefined})

function References(props: {text: string; tick: number}) {
	const navigate = useContext(Navigation)
	return (
		<>
			{Array.map(String.split(/(#-?\d+|\(-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\))/u)(props.text), (part, index) => {
				if (String.startsWith('#')(part)) {
					return (
						<Button
							variant="link"
							key={index}
							className="text-foreground underline decoration-dotted underline-offset-4"
							onClick={() =>
								navigate.entity(
									Option.getOrElse(Number.parse(String.slice(1)(part)), () => 0),
									props.tick
								)
							}
						>
							{part}
						</Button>
					)
				}
				return Option.match(String.match(/^\((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)$/u)(part), {
					onNone: () => <span key={index}>{part}</span>,
					onSome: found => (
						<Button
							variant="link"
							key={index}
							className="underline decoration-dotted underline-offset-4"
							onClick={() =>
								navigate.place(
									Option.getOrElse(Number.parse(found[1] ?? ''), () => 0),
									Option.getOrElse(Number.parse(found[2] ?? ''), () => 0),
									props.tick
								)
							}
						>
							{part}
						</Button>
					)
				})
			})}
		</>
	)
}

function Portrait(props: {className?: string; kind: string}) {
	return Option.match(Record.get(useContext(Portraits), props.kind), {
		onNone: () => <span aria-hidden="true" className={cn('bg-muted block flex-none', props.className)} />,
		onSome: source => (
			<img src={source} alt={props.kind} draggable={false} className={cn('block flex-none', props.className)} />
		)
	})
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

// A team thinking now is live, one waiting is quiet, one that failed shows the error.
function TeamStatus(props: {status: TeamView['status']}) {
	return (
		<span title={props.status} className="inline-flex">
			<StatusDot
				status={pipe(
					Match.value(props.status),
					Match.when('thinking', () => 'live' as const),
					Match.when('failed', () => 'error' as const),
					Match.orElse(() => 'quiet' as const)
				)}
				waiting={props.status === 'thinking'}
			/>
		</span>
	)
}

function Teams(props: {onPick: (team: number) => void; picked: number; teams: View['teams']}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="flex min-h-11 items-center gap-2" aria-label="Choose team">
				<Swatch team={props.picked} />
				{teamName(props.picked)}
				<span className="text-muted-foreground">▾</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="min-w-48">
				<DropdownMenuItem className="min-h-11" onClick={() => props.onPick(-1)}>
					All teams
				</DropdownMenuItem>
				{Array.map(props.teams, team => (
					<DropdownMenuItem key={team.id} className="min-h-11" onClick={() => props.onPick(team.id)}>
						<Swatch team={team.id} />
						{team.name}
						<span className="ml-auto">
							<TeamStatus status={team.status} />
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
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

function Outcome(props: {outcome: Entry['commands'][number]; tick: number}) {
	const navigate = useContext(Navigation)
	return (
		<li>
			<details>
				<summary className={cn('cursor-pointer py-1', !props.outcome.ok && 'text-destructive')}>
					{Boolean.match(props.outcome.ok, {onFalse: () => '✕', onTrue: () => '✓'})} {props.outcome.command._tag}
				</summary>
				<dl className="grid grid-cols-3 gap-x-3 gap-y-2 py-2">
					{Array.map(Record.toEntries(argumentsOf(props.outcome.command)), field => (
						<div key={field[0]} className="contents">
							<dt className="text-muted-foreground">{field[0]}</dt>
							<dd className="col-span-2 min-w-0 break-words">
								{Boolean.match(
									Predicate.isNumber(field[1]) &&
										Array.contains(['building', 'unit', 'target', 'from', 'to'], field[0]),
									{
										onFalse: () => (
											<References
												text={Boolean.match(Array.contains(['units', 'facts'], field[0]), {
													onFalse: () =>
														Boolean.match(Predicate.isString(field[1]), {
															onFalse: () => JSON.stringify(field[1]),
															onTrue: () => `${field[1]}`
														}),
													onTrue: () =>
														Array.join(
															Array.map(Array.ensure(field[1]), id => `#${id}`),
															', '
														)
												})}
												tick={props.tick}
											/>
										),
										onTrue: () => <References text={`#${field[1]}`} tick={props.tick} />
									}
								)}
							</dd>
						</div>
					))}
				</dl>
				{Option.getOrUndefined(
					Option.map(commandPlace(props.outcome.command), at => (
						<Button
							variant="link"
							className="underline underline-offset-4"
							onClick={() => navigate.place(at.x, at.z, props.tick)}
						>
							Locate objective
						</Button>
					))
				)}
				<p className="pb-2 leading-relaxed break-words whitespace-pre-wrap">
					<References text={props.outcome.text} tick={props.tick} />
				</p>
			</details>
		</li>
	)
}
// One round of a team's thread: when, what it was told, what it thought and said, and what each command did.
function Round(props: {entry: Entry}) {
	const navigate = useContext(Navigation)
	return (
		<li className="flex flex-col gap-2 pt-3">
			<header className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
				<span className="text-(--team)" style={{'--team': teamColor(props.entry.team)}}>
					{teamName(props.entry.team)} Core
				</span>
				<Button
					variant="link"
					className="text-muted-foreground font-mono text-xs underline decoration-dotted"
					onClick={() => navigate.time(props.entry.tick)}
				>
					{clockOf(props.entry.tick)}
				</Button>
				{props.entry.tokens?.cost !== undefined && <span>${Number.round(props.entry.tokens.cost, 5)}</span>}
				{props.entry.status !== 'done' && <span className="text-destructive">{props.entry.status}</span>}
				{Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(props.entry.tokens), tokens => (
						<span className="ml-auto">
							{Boolean.match(tokens.input !== undefined && tokens.output !== undefined, {
								onFalse: () => '',
								onTrue: () => `${Number.round(((tokens.input ?? 0) + (tokens.output ?? 0)) / 1000, 1)}k tok`
							})}
						</span>
					))
				)}
			</header>
			{Array.isReadonlyArrayNonEmpty(props.entry.notices) && (
				<ul className="flex flex-col gap-1">
					{Array.map(props.entry.notices, (notice, index) => (
						<Notice key={index} text={notice} tick={props.entry.observed ?? props.entry.tick} />
					))}
				</ul>
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
			{String.isNonEmpty(String.trim(props.entry.text)) && (
				<p className="leading-relaxed whitespace-pre-wrap">
					<References text={String.trim(props.entry.text)} tick={props.entry.tick} />
				</p>
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
				<pre className="text-muted-foreground mt-2 font-mono leading-relaxed whitespace-pre-wrap">
					<References text={props.entry.observation} tick={props.entry.observed ?? props.entry.tick} />
				</pre>
			</details>
			{props.entry.tokens !== undefined &&
				Array.some(
					[
						props.entry.tokens.cached,
						props.entry.tokens.cost,
						props.entry.tokens.input,
						props.entry.tokens.output,
						props.entry.tokens.written,
						props.entry.tokens.compaction
					],
					value => value !== undefined
				) && (
					<details>
						<summary className="text-muted-foreground cursor-pointer">
							Usage ·{' '}
							{Boolean.match(props.entry.tokens.cost !== undefined, {
								onFalse: () => 'cost not reported',
								onTrue: () => `$${Number.round(props.entry.tokens?.cost ?? 0, 5)}`
							})}
						</summary>
						<pre className="break-words whitespace-pre-wrap">{JSON.stringify(props.entry.tokens, undefined, 2)}</pre>
					</details>
				)}
		</li>
	)
}

function historyTeam(entry: Experience, members: Record<string, number>) {
	return entry.team ?? members[entry.actor]
}

function EventRecord(props: {entry: Experience}) {
	const navigate = useContext(Navigation)
	const team = historyTeam(props.entry, useContext(Membership))
	return (
		<li className="flex flex-col gap-1 py-1">
			<header className="text-muted-foreground flex items-center gap-2">
				<Button
					variant="link"
					className="text-muted-foreground h-auto p-0 font-mono text-xs"
					onClick={() => navigate.place(props.entry.x, props.entry.z, props.entry.tick)}
				>
					{clockOf(props.entry.tick)}
				</Button>
				{team !== undefined && (
					<span className="text-(--team)" style={{'--team': teamColor(team)}}>
						{teamName(team)}
					</span>
				)}
				<Button
					variant="link"
					className="text-muted-foreground h-auto p-0 text-xs"
					onClick={() => navigate.entity(props.entry.actor, props.entry.tick)}
				>
					#{props.entry.actor}
				</Button>
				<span className="text-xs">{props.entry.kind}</span>
			</header>
			<p className="leading-relaxed">
				<References text={props.entry.text} tick={props.entry.tick} />
			</p>
		</li>
	)
}

// Opening older pages freezes this page's upper cursor so incoming records cannot create a gap.
function ThreadPage(props: {
	before?: number
	replaying: boolean
	team: number
	tick: number
	onEarlier: () => void
	onLatest: () => void
	onRead: () => void
}) {
	const members = useContext(Membership)
	const [expanded, setExpanded] = useState(() => Option.none<{before: number; upper: number}>())
	const before = Option.getOrElse(
		Option.map(expanded, page => page.upper),
		() => props.before ?? Boolean.match(props.replaying, {onFalse: () => -1, onTrue: () => props.tick})
	)
	const result = useAtomValue(feedAtom(before))
	const currentPage = Option.getOrElse(AsyncResult.value(result), () => ({before: -1, entries: []}))
	const entries = currentPage.entries
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
							tick={props.tick}
							replaying={props.replaying}
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
			{Array.map(
				Array.filter(entries, entry => {
					if (props.team === -1) return true
					if (entry.kind === 'core') return entry.value.team === props.team
					return historyTeam(entry.value, members) === props.team
				}),
				entry => {
					if (entry.kind === 'core') {
						return <Round key={`core:${entry.value.team}:${entry.value.round}`} entry={entry.value} />
					}
					return <EventRecord key={`event:${entry.value.id}`} entry={entry.value} />
				}
			)}
		</>
	)
}

function Thread(props: {replaying: boolean; status?: TeamView['status']; team: number; tick: number}) {
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
			className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pb-3 select-text"
		>
			<ThreadPage
				team={props.team}
				tick={props.tick}
				replaying={props.replaying}
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

function HistoryGroup(props: {compact?: boolean; entries: readonly Experience[]}) {
	const first = Option.getOrThrow(Array.head(props.entries))
	const team = historyTeam(first, useContext(Membership))
	const navigate = useContext(Navigation)
	const observations = Array.filter(props.entries, entry => entry.context === undefined && entry.kind === 'observe')
	return (
		<li className="flex flex-col gap-2">
			{team !== undefined && (
				<span className="text-(--team)" style={{'--team': teamColor(team)}}>
					{teamName(team)} · {first.actorKind ?? 'Individual'}
				</span>
			)}
			<div className="text-muted-foreground flex flex-wrap items-center gap-x-1">
				<Button
					variant="link"
					className="px-0 underline decoration-dotted"
					onClick={() => navigate.place(first.x, first.z, first.tick)}
				>
					{clockOf(first.tick)}
				</Button>
				{props.compact !== true && (
					<Button
						variant="link"
						className="px-1 underline decoration-dotted"
						onClick={() => navigate.entity(first.actor, first.tick)}
					>
						#{first.actor}
					</Button>
				)}
				{props.compact !== true && (
					<span>
						({Number.round(first.x, 1)}, {Number.round(first.z, 1)})
					</span>
				)}
			</div>
			{Array.map(
				Array.filter(props.entries, entry => entry.context === undefined && entry.kind !== 'observe'),
				entry => (
					<p key={entry.id} className="leading-relaxed break-words">
						{props.compact !== true && <span className="text-muted-foreground">{entry.kind} · </span>}
						<References text={entry.text} tick={entry.tick} />
					</p>
				)
			)}
			{props.compact !== true && Array.isReadonlyArrayNonEmpty(observations) && (
				<details>
					<summary className="text-muted-foreground cursor-pointer">Observations · {observations.length}</summary>
					<ul className="flex flex-col gap-2 pt-2">
						{Array.map(observations, entry => (
							<li key={entry.id} className="leading-relaxed break-words">
								<References text={entry.text} tick={entry.tick} />
							</li>
						))}
					</ul>
				</details>
			)}
			{props.compact !== true &&
				Array.map(
					Array.filter(props.entries, entry => entry.context !== undefined),
					entry => (
						<details key={entry.id}>
							<summary className="text-muted-foreground cursor-pointer">Decision input and usage</summary>
							<p className="py-2">{entry.text}</p>
							<pre className="break-words whitespace-pre-wrap">
								{entry.context}
								{'\n'}
								{JSON.stringify(entry.tokens, undefined, 2)}
							</pre>
						</details>
					)
				)}
		</li>
	)
}

function HistoryPage(props: {
	actor: number | 'all'
	at?: number
	before?: number
	compact?: boolean
	onEarlier: () => void
	onLatest: () => void
	onRead: () => void
}) {
	const [expanded, setExpanded] = useState(() => Option.none<{at?: number; before: number; upper: number}>())
	const result = useAtomValue(
		historyAtom(
			`${props.actor}:${Option.getOrElse(
				Option.map(expanded, page => page.upper),
				() => props.before ?? 0
			)}:${Option.match(expanded, {onNone: () => props.at ?? -1, onSome: page => page.at ?? -1})}`
		)
	)
	const entries = Option.getOrElse(AsyncResult.value(result), () => [])
	const shown = Boolean.match(props.compact === true, {
		onFalse: () => entries,
		onTrue: () =>
			Option.match(
				Array.last(Array.filter(entries, entry => entry.kind !== 'observe' && entry.context === undefined)),
				{
					onNone: () => [],
					onSome: last => Array.filter(entries, entry => entry.actor === last.actor && entry.tick === last.tick)
				}
			)
	})
	useEffect(() => {
		if (props.before === undefined) props.onRead()
	})
	return (
		<>
			{props.compact !== true &&
				Option.match(expanded, {
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
												setExpanded(
													Option.some({
														at: props.at,
														before: first.id,
														upper: Option.getOrThrow(Array.last(entries)).id + 1
													})
												)
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
								at={page.at}
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
			{Array.map(Record.values(Array.groupBy(shown, entry => `${entry.actor}:${entry.tick}`)), entriesInTick => (
				<HistoryGroup
					key={Option.getOrThrow(Array.head(entriesInTick)).id}
					compact={props.compact}
					entries={entriesInTick}
				/>
			))}
		</>
	)
}

function Chronicle(props: {actor: number | 'all'; at?: number}) {
	const list = useRef<HTMLDivElement>(null)
	const pinned = useRef(true)
	const [full, setFull] = useState(() => props.actor === 'all')
	return (
		<div
			ref={list}
			onScroll={event => {
				pinned.current =
					event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24
			}}
			aria-label={Boolean.match(props.actor === 'all', {
				onFalse: () => 'Private individual history',
				onTrue: () => 'World history'
			})}
			className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3 select-text"
		>
			<ol className="flex flex-col gap-4">
				<HistoryPage
					key={`${full}`}
					actor={props.actor}
					at={props.at}
					compact={!full}
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
			{!full && (
				<Button variant="ghost" className="mt-2 min-h-11 px-0" onClick={() => setFull(true)}>
					View full history →
				</Button>
			)}
		</div>
	)
}

// The tick on screen: a replay still loading shows nothing yet, so it is at the replay's start.
function shownTick(source: Source, tick: number) {
	return Option.match(source, {onNone: () => tick, onSome: replay => Number.max(replay.from, tick)})
}

// The followed unit: its portrait beside what it does and its health.
function Followed(props: {unit: UnitView}) {
	return (
		<div className="flex flex-none items-center gap-3 px-3 pb-2">
			<Portrait kind={props.unit.kind} className="size-9" />
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-1.5 first-letter:uppercase">{doingOf(props.unit)}</p>
				<Meter value={percent(props.unit.health)}>
					<Pips value={props.unit.health} />
				</Meter>
			</div>
		</div>
	)
}

function Sidebar(props: {close: () => void; selection: Inspection; source: Source; view: View}) {
	const [filter, setFilter] = useState(-1)
	const picked = Array.findFirst(
		props.view.teams,
		team => team.id === filter || (filter === -1 && team.status === 'thinking')
	)
	return (
		<div className="pointer-events-none absolute inset-x-0 top-16 bottom-0 z-20 flex items-end p-2 md:top-20 md:p-4">
			<aside
				aria-label="Inspector"
				className="bg-popover text-popover-foreground pointer-events-auto flex max-h-1/2 min-h-0 w-full flex-col md:max-h-full md:w-80"
			>
				<header className="flex min-h-11 flex-none items-center gap-2 px-3">
					{props.selection.kind === 'thread' && <Teams teams={props.view.teams} picked={filter} onPick={setFilter} />}
					{props.selection.kind === 'history' && (
						<span>
							{Option.match(props.selection.actor, {
								onNone: () => 'World history',
								onSome: actor => `Individual #${actor}`
							})}
						</span>
					)}
					<Button
						className="ml-auto min-h-11 min-w-11"
						size="icon-sm"
						aria-label="Close inspector"
						variant="ghost"
						onClick={props.close}
					>
						×
					</Button>
				</header>
				{props.selection.kind === 'thread' && (
					<Thread
						key={`${filter}:${Option.getOrElse(
							Option.map(props.source, replay => replay.from),
							() => 'live'
						)}`}
						team={filter}
						tick={shownTick(props.source, props.view.frame.tick)}
						replaying={Option.isSome(props.source)}
						status={Option.getOrUndefined(
							Option.map(
								Option.filter(picked, () => Option.isNone(props.source)),
								team => team.status
							)
						)}
					/>
				)}
				{props.selection.kind === 'history' && (
					<>
						{Option.getOrUndefined(
							Option.map(
								Option.flatMap(props.selection.actor, id =>
									Array.findFirst(props.view.frame.units, unit => unit.id === id)
								),
								unit => <Followed unit={unit} />
							)
						)}
						<Chronicle
							key={`${Option.getOrElse(props.selection.actor, () => 'all')}:${Option.getOrElse(
								Option.map(props.source, replay => replay.from),
								() => 'live'
							)}`}
							actor={Option.getOrElse(props.selection.actor, () => 'all' as const)}
							at={Option.getOrUndefined(
								Option.map(props.source, replay => {
									if (replay.speed === 0) return Number.max(replay.from, props.view.frame.tick)
									return Number.max(replay.from, Math.floor(props.view.frame.tick / (5 * TICK_HZ)) * 5 * TICK_HZ)
								})
							)}
						/>
					</>
				)}
			</aside>
		</div>
	)
}

// Play or pause: the live world pauses where it is, a playing replay holds still, a paused one plays on at real time.
function toggled(source: Source, tick: number) {
	if (Option.match(source, {onNone: () => true, onSome: replay => replay.speed > 0})) {
		return Option.some({from: tick, speed: 0}) satisfies Source
	}
	return Option.some({from: tick, speed: 1}) satisfies Source
}

// Where a mark sits on the timeline and how it looks: a milestone a square of its team's colour, a contact a diamond, a message a dot, a unit down a cross.
function MarkGlyph(props: {mark: Mark; span: Timeline}) {
	return (
		<i
			title={`${clockOf(props.mark.tick)} ${teamName(props.mark.team)} ${props.mark.kind}${Option.getOrElse(
				Option.map(Option.fromUndefinedOr(props.mark.other), other => ` · ${teamName(other)}`),
				() => ''
			)}`}
			className={cn(
				'absolute left-(--at) -translate-x-1/2 bg-(--team)',
				props.mark.kind === 'milestone' && 'top-1 size-2',
				props.mark.kind === 'contact' && 'top-0.5 size-2.5 rotate-45 border border-(--other)',
				props.mark.kind === 'message' && 'top-1.5 size-1 rounded-full',
				props.mark.kind === 'down' && 'bg-destructive top-1.5 size-1'
			)}
			style={{
				'--at': percent((props.mark.tick - props.span.start) / Number.max(1, props.span.live - props.span.start)),
				'--other': teamColor(props.mark.other ?? props.mark.team),
				'--team': teamColor(props.mark.team)
			}}
		/>
	)
}

// The run from its first moment to now: its marks, where the screen is, play and pause, the replay's speed and the way back to live.
function TimelineBar(props: {source: Source; tick: number; timeline: Timeline; onSource: (source: Source) => void}) {
	const live = Option.isNone(props.source)
	const span = {...props.timeline, live: Number.max(props.timeline.live, props.tick)}
	const length = Number.max(1, span.live - span.start)
	const speed = Option.getOrElse(
		Option.map(props.source, replay => replay.speed),
		() => 1
	)
	return (
		<section aria-label="Timeline" className="bg-popover flex flex-none flex-wrap items-center gap-1 px-2">
			<Button
				variant="ghost"
				size="icon"
				className="min-h-11 min-w-11"
				aria-label={Boolean.match(live, {
					onFalse: () => Boolean.match(speed > 0, {onFalse: () => 'Play replay', onTrue: () => 'Pause replay'}),
					onTrue: () => 'Replay from beginning'
				})}
				onClick={() =>
					props.onSource(
						Boolean.match(live, {
							onFalse: () => toggled(props.source, props.tick),
							onTrue: () => Option.some({from: span.start, speed: 1})
						})
					)
				}
			>
				{Boolean.match(!live && speed > 0, {onFalse: () => '▶', onTrue: () => '❚❚'})}
			</Button>

			<span className="text-muted-foreground font-mono tabular-nums" aria-live="off">
				{clockOf(props.tick)}
			</span>
			{!live && (
				<span className="text-muted-foreground font-mono">{clockOf(Number.max(0, span.live - props.tick))} behind</span>
			)}
			<div className="relative order-first h-8 w-full flex-none">
				<div className="bg-border pointer-events-none absolute inset-x-1 top-1/2 h-0.5">
					<div
						className="bg-primary h-full w-(--fill)"
						style={{'--fill': percent((props.tick - span.start) / length)}}
					/>
				</div>
				<div className="pointer-events-none absolute inset-x-1 top-1">
					{Array.map(props.timeline.marks, (mark, index) => (
						<MarkGlyph key={index} mark={mark} span={span} />
					))}
				</div>
				<input
					className="signal-time absolute inset-0 m-0 h-8 w-full cursor-ew-resize"
					aria-label="Replay time"
					aria-valuetext={`${clockOf(props.tick)} of ${clockOf(span.live)}`}
					type="range"
					min={span.start}
					max={span.live}
					value={props.tick}
					onChange={event => props.onSource(Option.some({from: event.currentTarget.valueAsNumber, speed: 0}))}
				/>
			</div>

			<Button
				variant="ghost"
				size="sm"
				className="text-primary ml-auto min-h-11"
				onClick={() => props.onSource(Option.none())}
				aria-label="Back to latest"
			>
				{Boolean.match(live, {onFalse: () => '○ Go live', onTrue: () => '● Live'})}
			</Button>

			{!live && (
				<DropdownMenu>
					<DropdownMenuTrigger aria-label="Replay speed" className="text-muted-foreground min-h-11 min-w-11">
						{Number.max(1, speed)}×
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{Array.map(SPEEDS, entry => (
							<DropdownMenuItem
								key={entry}
								className="min-h-11"
								onClick={() => props.onSource(Option.some({from: props.tick, speed: entry}))}
							>
								{entry}×
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
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
			{Option.getOrUndefined(
				Option.map(
					Option.flatMap(
						Option.filter(props.info, info => Option.isNone(props.building) && info.field === undefined),
						info => Option.fromUndefinedOr(info.prop)
					),
					prop => <p className="first-letter:uppercase">{String.replaceAll('-', ' ')(prop)}</p>
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

// Where the camera goes this frame: the overview over the team, a place the player left it at, the followed unit as drawn, or the team's Home.
function aimOf(follow: Follow, team: number, view: View, world: {cast: Cast; renderer: Renderer}) {
	const home = Option.getOrElse(
		Option.map(
			Array.findFirst(view.teams, entry => entry.id === team),
			entry => entry.home
		),
		() => ({x: 0, z: 0})
	)
	if (follow.overview) {
		const frame = world.renderer.fit([
			...Array.map(view.teams, entry => entry.home),
			...Array.filter(view.frame.units, unit => unit.team !== undefined)
		])
		return {
			key: 'overview',
			x: frame.x,
			y: world.renderer.ground(frame.x, frame.z),
			z: frame.z,
			zoom: Option.some(frame.zoom)
		}
	}
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
					onNone: () => ({
						key: `home:${team}`,
						x: home.x,
						y: world.renderer.ground(home.x, home.z),
						z: home.z,
						zoom: Option.none()
					}),
					onSome: followed => ({key: `unit:${followed.id}`, ...followed.at, zoom: Option.none()})
				}
			),
		onSome: at => ({
			key: `free:${at.x}:${at.z}`,
			x: at.x,
			y: world.renderer.ground(at.x, at.z),
			z: at.z,
			zoom: Option.none()
		})
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
					onSome: active =>
						setFollow(current => ({...current, free: Option.some(active.renderer.detach()), overview: false}))
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

function WorldControl(props: {onThreads: () => void}) {
	const status = useAtomValue(runStateAtom)
	const [result, control] = useAtom(controlAtom)
	const current = Option.getOrUndefined(AsyncResult.value(status))
	const problem =
		current?.problem ?? Option.getOrUndefined(Option.map(AsyncResult.error(result), error => error.message))
	return (
		<div className="relative">
			<Button
				variant="secondary"
				className="min-h-11 px-3"
				disabled={!AsyncResult.isSuccess(status) || result.waiting || current?.problem !== undefined}
				onClick={() => control({payload: {running: current?.running !== true}})}
			>
				{result.waiting && <Spinner />}
				{!result.waiting && (
					<span className="text-primary" aria-hidden="true">
						{Boolean.match(current?.running === true, {onFalse: () => '▶', onTrue: () => 'Ⅱ'})}
					</span>
				)}
				{Option.match(Option.fromUndefinedOr(current), {
					onNone: () => 'Connecting',
					onSome: state => Boolean.match(state.running, {onFalse: () => 'Run world', onTrue: () => 'Pause world'})
				})}
			</Button>
			{current !== undefined && (!current.coreConfigured || !current.localDecisions) && (
				<Button
					variant="secondary"
					onClick={props.onThreads}
					className="bg-popover text-warning mt-1 block h-auto max-w-56 px-2 py-1 text-left text-xs whitespace-normal"
				>
					{!current.coreConfigured && 'Model key missing'}
					{!current.coreConfigured && !current.localDecisions && ' · '}
					{!current.localDecisions &&
						Boolean.match(current.coreConfigured, {onFalse: () => 'Local off', onTrue: () => 'Local decisions off'})}
				</Button>
			)}
			{problem !== undefined && (
				<p role="alert" className="bg-popover text-destructive absolute top-full right-0 mt-1 w-64 p-2">
					{problem}
				</p>
			)}
			{AsyncResult.isFailure(status) && (
				<p role="alert" className="bg-popover text-destructive absolute top-full right-0 mt-1 w-64 p-2">
					World control disconnected.
				</p>
			)}
		</div>
	)
}

// The world view and everything over it: the canvas belongs to the renderer, and frames reach it through the registry, not React.
function MapControls(props: {
	follow: Follow
	onFollow: (follow: Follow) => void
	onInspect: (inspection: Inspection) => void
	view: View
}) {
	const [coverage, setCoverage] = useAtom(coverageAtom)
	return (
		<>
			<div className="absolute top-2 left-2 z-30 flex gap-1 md:top-4 md:left-4" aria-label="Team footprints">
				{Array.map(props.view.teams, entry => (
					<Button
						key={entry.id}
						variant="secondary"
						size="sm"
						className="min-h-11 text-(--team)"
						style={{'--team': entry.color}}
						aria-pressed={coverage === entry.id}
						onClick={() =>
							setCoverage(Boolean.match(coverage === entry.id, {onFalse: () => entry.id, onTrue: () => -1}))
						}
					>
						{entry.name}
					</Button>
				))}
			</div>
			<nav
				aria-label="Map controls"
				className="absolute top-14 right-2 z-30 flex items-start gap-1 md:top-4 md:right-4"
			>
				<WorldControl onThreads={() => props.onInspect({kind: 'thread'})} />
				<DropdownMenu>
					<DropdownMenuTrigger aria-label="View options" className="bg-popover min-h-11 min-w-11 px-3">
						···
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-48">
						<DropdownMenuItem className="min-h-11" onClick={() => props.onInspect({kind: 'thread'})}>
							Threads
						</DropdownMenuItem>
						<DropdownMenuItem
							className="min-h-11"
							onClick={() => props.onFollow({...props.follow, overview: !props.follow.overview})}
						>
							Fit all teams
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</nav>
		</>
	)
}

function placeTeamLabels(renderer: Renderer, teams: View['teams'], root?: HTMLElement | null) {
	for (const label of root?.querySelectorAll<HTMLElement>('[data-home]') ?? []) {
		const team = Array.findFirst(teams, entry => `${entry.id}` === label.dataset['home'])
		label.hidden = renderer.span() < 32 || Option.isNone(team)
		Option.match(team, {
			onNone: () => undefined,
			onSome: entry => {
				const at = renderer.project(entry.home.x, renderer.ground(entry.home.x, entry.home.z) + 3, entry.home.z)
				label.style.transform = `translate(${at.x}px, ${at.y}px)`
			}
		})
	}
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
	const [follow, setFollow] = useAtom(followAtom)
	const setTeam = useAtomSet(teamAtom)
	const [source, setSource] = useAtom(sourceAtom)
	const [panel, setPanel] = useState(Option.none<Inspection>)
	const timeline = useAtomValue(timelineAtom)

	const [portraits, setPortraits] = useState<Record<string, string>>({})
	// What the key handler and the camera read, kept current outside render.
	const latest = useRef({source, view: props.view})
	useEffect(() => {
		latest.current = {source, view: props.view}
	}, [source, props.view])

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
					Option.liftPredicate(answer, entry => entry.field !== undefined || entry.prop !== undefined),
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
		// Each frame, before the camera moves: it aims at its subject, and the followed unit is edged.
		renderer.onFrame(() => {
			const current = registry.get(followAtom)
			const run = Option.getOrUndefined(AsyncResult.value(registry.get(runStateAtom)))
			renderer.clock(
				latest.current.view.frame.tick,
				Option.match(registry.get(sourceAtom), {
					onNone: () => Boolean.match(run?.running === true, {onFalse: () => 0, onTrue: () => 1}),
					onSome: replay => replay.speed
				})
			)
			renderer.coverage(registry.get(coverageAtom))
			renderer.aim(aimOf(current, registry.get(teamAtom), latest.current.view, active))
			renderer.focus(Option.flatMap(current.id, cast.objectOf), teamColor(registry.get(teamAtom)))
		})
		// Once the camera has moved: health pips and the hover card follow their units. Zoomed far out, pips only clutter, so they hide.
		renderer.onDrawn(() => {
			placeTeamLabels(renderer, latest.current.view.teams, canvas.current?.parentElement)
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
			registry.set(followAtom, {free: Option.none(), id, overview: false})
			if (Option.isSome(id)) {
				setPanel(before =>
					Option.map(before, inspection => {
						if (inspection.kind !== 'history' || Option.isNone(inspection.actor)) return inspection
						return {...inspection, actor: id}
					})
				)
			}
			renderer.centre()
		}
		// Esc steps back one thing: out of the overview, else frees the camera where it looks, else follows the team again.
		function leave() {
			const current = registry.get(followAtom)
			if (current.overview) {
				registry.set(followAtom, {...current, overview: false})
			} else if (Option.isNone(current.free)) {
				registry.set(followAtom, {free: Option.some(renderer.looking()), id: Option.none(), overview: false})
			} else {
				cycle(1)
			}
		}
		function pick(next: number) {
			registry.set(teamAtom, next)
			registry.set(followAtom, {free: Option.none(), id: Option.none(), overview: registry.get(followAtom).overview})
			renderer.centre()
		}
		const actions = {
			in: () => renderer.zoomBy(1 / ZOOM_STEP),
			leave,
			next: () => cycle(1),
			out: () => renderer.zoomBy(ZOOM_STEP),
			overview: () =>
				registry.set(followAtom, {...registry.get(followAtom), overview: !registry.get(followAtom).overview}),
			play: () =>
				registry.set(
					sourceAtom,
					toggled(latest.current.source, shownTick(latest.current.source, latest.current.view.frame.tick))
				),
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
			cast.dispose()
			renderer.dispose()
		}
	}, [registry, props.seed, setGround])

	function followUnit(id: number) {
		const unit = Option.getOrUndefined(Array.findFirst(props.view.frame.units, entry => entry.id === id))
		if (unit?.team !== undefined) setTeam(unit.team)
		setFollow({free: Option.none(), id: Option.some(id), overview: false})
		setPanel(Option.some({actor: Option.some(id), kind: 'history'}))
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

	function locateEntity(id: number, tick: number) {
		if (id < 0) {
			setFollow({free: Option.some(tileOf(-1 - id)), id: Option.none(), overview: false})
		} else {
			setFollow({free: Option.none(), id: Option.some(id), overview: false})
		}
		if (id > 0 && !Array.some(props.view.buildings, entry => entry.id === id)) {
			setPanel(Option.some({actor: Option.some(id), kind: 'history'}))
		}
		if (tick !== props.view.frame.tick) setSource(Option.some({from: tick, speed: 0}))
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
	}

	return (
		<Navigation
			value={{
				entity: locateEntity,
				place: (x, z, tick) => {
					setFollow({free: Option.some({x, z}), id: follow.id, overview: false})
					if (tick !== props.view.frame.tick) setSource(Option.some({from: tick, speed: 0}))
					Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
				},
				time: tick => setSource(Option.some({from: tick, speed: 0}))
			}}
		>
			<Portraits value={portraits}>
				<Membership
					value={Record.fromEntries([
						...Array.getSomes(
							Array.map(props.view.frame.units, unit =>
								Option.map(Option.fromUndefinedOr(unit.team), owner => [`${unit.id}`, owner] as const)
							)
						),
						...Array.map(props.view.buildings, building => [`${building.id}`, building.team] as const)
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
							{Array.map(props.view.teams, entry => (
								<div key={entry.id} hidden data-home={entry.id} className="pointer-events-none absolute top-0 left-0">
									<span
										className="bg-popover inline-block -translate-x-1/2 px-2 py-1 text-xs text-(--team)"
										style={{'--team': entry.color}}
									>
										{entry.name}
									</span>
								</div>
							))}
							<MapControls
								follow={follow}
								onFollow={setFollow}
								onInspect={inspection => setPanel(Option.some(inspection))}
								view={props.view}
							/>
							<ReplayLoading />
							{Option.getOrUndefined(
								Option.map(panel, pickedPanel => (
									<Sidebar
										selection={pickedPanel}
										close={() => setPanel(Option.none())}
										view={props.view}
										source={source}
									/>
								))
							)}
						</div>
						{Option.getOrUndefined(
							Option.map(AsyncResult.value(timeline), entry => (
								<TimelineBar
									timeline={entry}
									tick={shownTick(source, props.view.frame.tick)}
									source={source}
									onSource={setSource}
								/>
							))
						)}
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
