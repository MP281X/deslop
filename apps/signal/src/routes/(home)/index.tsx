import {RegistryContext, useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Number, Option, Predicate, Record, String, Struct} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {PointerEvent, ReactNode, WheelEvent} from 'react'
import {createContext, useContext, useEffect, useRef, useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {cn} from '@deslop/components-web/utils'

import {createCast} from './-cast.ts'
import type {Cast} from './-cast.ts'
import type {Inspected} from './-chunks.worker.ts'
import {createRenderer} from './-renderer.ts'
import type {Renderer} from './-renderer.ts'

import {
	EMPTY,
	followAtom,
	hoverAtom,
	historyAtom,
	hudAtom,
	liveThreadAtom,
	pastThreadAtom,
	seedAtom,
	sourceAtom,
	teamAtom,
	timelineAtom,
	usageAtom,
	viewAtom
} from '#lib/utils.ts'
import type {Follow, Source, View} from '#lib/utils.ts'
import {ROUND, TEAMS, TICK_HZ} from '#services/game/lib/utils.ts'
import type {BuildingView, Entry, Experience, Mark, TeamView, Timeline, UnitView} from '#services/game/schema.ts'
import {UnitKind} from '#services/game/schema.ts'
import {tileOf} from '#services/world/lib/utils.ts'

const ZOOM_STEP = 1.25
// The replay speeds, in multiples of real time.
const SPEEDS = [1, 10, 30]
// The minimap's size in pixels.
const MAP = {height: 220, width: 376}
// A chunk's side in tiles, as the minimap draws explored ground at two tiles a pixel.
const CHUNK = 32
const groundAtom = Atom.make({at: Option.none<{x: number; z: number}>(), info: Option.none<Inspected>(), x: 0, y: 0})

type Key = 'in' | 'leave' | 'left' | 'next' | 'out' | 'overview' | 'play' | 'previous' | 'right'

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

function letterKey(code: string, repeat: boolean) {
	if (repeat) return Option.none<Key>()
	if (code === 'KeyQ') return Option.some<Key>('overview')
	if (code === 'KeyZ') return Option.some<Key>('left')
	if (code === 'KeyX') return Option.some<Key>('right')
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

function StatusDot(props: {status: TeamView['status']}) {
	return (
		<i
			title={props.status}
			className={cn(
				'inline-block size-1.5 rounded-full',
				props.status === 'thinking' && 'bg-foreground motion-safe:animate-pulse',
				props.status === 'waiting' && 'bg-muted-foreground/40',
				props.status === 'failed' && 'bg-destructive'
			)}
		/>
	)
}

// The teams side by side: milestones paid, buildings standing, units and whether its model is thinking. A row picks the team the thread and camera follow.
function Teams(props: {onPick: (team: number) => void; picked: number; teams: View['teams']}) {
	return (
		<>
			<div className="px-4 md:hidden">
				<DropdownMenu>
					<DropdownMenuTrigger className="flex min-h-11 w-full items-center gap-2 text-left" aria-label="Choose team">
						<Swatch team={props.picked} />
						{teamName(props.picked)}
						<span className="text-muted-foreground ml-auto">Change ▾</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						{Array.map(props.teams, team => (
							<DropdownMenuItem key={team.id} className="min-h-11" onClick={() => props.onPick(team.id)}>
								<Swatch team={team.id} />
								{team.name}
								<span className="text-muted-foreground ml-auto">
									{team.units} units · {team.gates + team.cycles} milestones
								</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<table className="hidden w-full tabular-nums md:table">
				<thead className="text-muted-foreground">
					<tr className="border-b">
						<th className="py-1.5 pl-4 text-left font-normal">Team</th>
						<th className="px-2 text-right font-normal" title="Milestones paid">
							Tier
						</th>
						<th className="px-2 text-right font-normal">Bldg</th>
						<th className="px-2 text-right font-normal">Units</th>
						<th className="pr-4">
							<span className="sr-only">Status</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{Array.map(props.teams, team => (
						<tr
							key={team.id}
							title={`${team.model} · next: ${team.gate}`}
							className={cn('hover:bg-accent cursor-pointer', team.id === props.picked && 'bg-accent')}
						>
							<td className="py-1.5 pl-4">
								<Button
									variant="ghost"
									className="min-h-11 w-full justify-start gap-2 px-0"
									aria-pressed={team.id === props.picked}
									onClick={() => props.onPick(team.id)}
								>
									<Swatch team={team.id} />
									{team.name}
									<kbd className="text-muted-foreground">{team.id + 1}</kbd>
								</Button>
							</td>
							<td className="px-2 text-right">{team.gates + team.cycles}</td>
							<td className="px-2 text-right">{team.buildings}</td>
							<td className="px-2 text-right">{team.units}</td>
							<td className="pr-4 text-right">
								<StatusDot status={team.status} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	)
}

// A notice a team's model read: a message from another team in a box of its colour, the rest as plain lines.
function Notice(props: {text: string}) {
	return Option.match(String.match(/^Message from team (\d+) \([^)]*\): ([\s\S]*)$/u)(props.text), {
		onNone: () => <li className="text-muted-foreground">{props.text}</li>,
		onSome: found => (
			<li className="bg-muted/60 px-3 py-2 leading-relaxed">
				<span className="mb-1 flex items-center gap-1.5">
					<Swatch team={Option.getOrElse(Number.parse(found[1] ?? ''), () => 0)} />
					{teamName(Option.getOrElse(Number.parse(found[1] ?? ''), () => 0))}
				</span>
				{found[2]}
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
			<header className="text-muted-foreground flex items-center gap-2">
				<Button variant="link" className="underline decoration-dotted" onClick={() => navigate.time(props.entry.tick)}>
					{clockOf(props.entry.tick)}
				</Button>
				<span>round {props.entry.round}</span>
				{props.entry.status !== 'done' && <span className="text-destructive">{props.entry.status}</span>}
				{Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(props.entry.tokens), tokens => (
						<span className="ml-auto">
							{Boolean.match(tokens.input !== undefined && tokens.output !== undefined, {
								onFalse: () => 'Tokens unreported',
								onTrue: () => `${Number.round(((tokens.input ?? 0) + (tokens.output ?? 0)) / 1000, 1)}k tok`
							})}
						</span>
					))
				)}
			</header>
			{Array.isReadonlyArrayNonEmpty(props.entry.notices) && (
				<ul className="flex flex-col gap-1">
					{Array.map(props.entry.notices, (notice, index) => (
						<Notice key={index} text={notice} />
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
					<References text={props.entry.observation} tick={props.entry.tick} />
				</pre>
			</details>
			{props.entry.tokens !== undefined && (
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

// Only the outer list scrolls. Opening older pages freezes this page's upper cursor so incoming events cannot create a gap.
function ThreadPage(props: {
	before?: number
	replaying: boolean
	team: number
	tick: number
	onEarlier: () => void
	onLatest: () => void
}) {
	const [expanded, setExpanded] = useState(() => Option.none<{before: number; upper: number}>())
	const before = Option.getOrElse(
		Option.map(expanded, page => page.upper),
		() => props.before ?? 0
	)
	const result = useAtomValue(
		Boolean.match(props.replaying || before > 0, {
			onFalse: () => liveThreadAtom(props.team),
			onTrue: () => pastThreadAtom(`${props.team}:${before || Math.floor(props.tick / ROUND) + 1}`)
		})
	)
	const entries = Option.getOrElse(AsyncResult.value(result), () => [])
	return (
		<>
			{Option.match(expanded, {
				onNone: () =>
					Option.getOrUndefined(
						Option.map(
							Option.filter(Array.head(entries), entry => entry.round > 1),
							first => (
								<li>
									<Button
										variant="ghost"
										onClick={() => {
											props.onEarlier()
											setExpanded(
												Option.some({before: first.round, upper: Option.getOrThrow(Array.last(entries)).round + 1})
											)
										}}
									>
										Earlier decisions
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
									Latest decisions
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
						/>
					</>
				)
			})}
			{AsyncResult.isFailure(result) && <li role="alert">Decisions could not be read.</li>}
			{Array.isReadonlyArrayEmpty(entries) && (
				<li className="text-muted-foreground py-3">
					{Boolean.match(AsyncResult.isWaiting(result), {
						onFalse: () => 'No decisions in this part of the recording.',
						onTrue: () => 'Loading…'
					})}
				</li>
			)}
			{Array.map(entries, entry => (
				<Round key={entry.round} entry={entry} />
			))}
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
			className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4 select-text"
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
			/>
			{props.status === 'thinking' && (
				<li className="text-muted-foreground flex items-center gap-2 py-3">
					<Spinner variant="subtle" className="size-3" />
					Thinking
				</li>
			)}
		</ol>
	)
}

function HistoryGroup(props: {entries: readonly Experience[]}) {
	const first = Option.getOrThrow(Array.head(props.entries))
	const navigate = useContext(Navigation)
	const observations = Array.filter(props.entries, entry => entry.context === undefined && entry.kind === 'observe')
	return (
		<li className="flex flex-col gap-2">
			<div className="text-muted-foreground flex flex-wrap items-center gap-x-1">
				<Button
					variant="link"
					className="px-0 underline decoration-dotted"
					onClick={() => navigate.place(first.x, first.z, first.tick)}
				>
					{clockOf(first.tick)}
				</Button>
				<Button
					variant="link"
					className="px-1 underline decoration-dotted"
					onClick={() => navigate.entity(first.actor, first.tick)}
				>
					#{first.actor}
				</Button>
				<span>
					({Number.round(first.x, 1)}, {Number.round(first.z, 1)})
				</span>
			</div>
			{Array.map(
				Array.filter(props.entries, entry => entry.context === undefined && entry.kind !== 'observe'),
				entry => (
					<p key={entry.id} className="leading-relaxed break-words">
						<span className="text-muted-foreground">{entry.kind} · </span>
						<References text={entry.text} tick={entry.tick} />
					</p>
				)
			)}
			{Array.isReadonlyArrayNonEmpty(observations) && (
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
			{Array.map(
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
			{Array.isReadonlyArrayEmpty(entries) && (
				<li className="text-muted-foreground py-3">
					{Boolean.match(AsyncResult.isWaiting(result), {
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

function Chronicle(props: {actor: number | 'all'; at?: number}) {
	const list = useRef<HTMLDivElement>(null)
	const pinned = useRef(true)
	return (
		<div
			ref={list}
			onScroll={event => {
				pinned.current =
					event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24
			}}
			className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 select-text"
		>
			<p className="text-muted-foreground py-3">
				{Boolean.match(props.actor === 'all', {
					onFalse: () => 'Private individual experience · not shared team knowledge.',
					onTrue: () =>
						'World events · spectator truth, not shared knowledge. Select an individual for its complete lifetime.'
				})}
				{props.at !== undefined && ` Through ${clockOf(props.at)}.`}
			</p>
			<ol className="flex flex-col gap-4">
				<HistoryPage
					actor={props.actor}
					at={props.at}
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

function UsageTotals() {
	const result = useAtomValue(usageAtom)
	return (
		<div className="max-h-56 overflow-y-auto pb-3 select-text">
			{AsyncResult.isFailure(result) && <p role="alert">Provider usage could not be read.</p>}
			{Option.getOrUndefined(
				Option.map(AsyncResult.value(result), ledger => (
					<>
						<p className="text-muted-foreground py-2">
							Recorded attempts only, not your account balance. Missing provider values are unknown, not zero.
							Development and production are separate.
							{ledger.since !== undefined &&
								Option.getOrUndefined(
									Option.map(
										DateTime.make(ledger.since),
										at => ` Since ${DateTime.formatLocal(at, {dateStyle: 'short', timeStyle: 'short'})}.`
									)
								)}
						</p>
						{Array.isReadonlyArrayEmpty(Record.values(ledger.groups)) && <p>No attempts recorded by this version.</p>}
						{Array.map(Record.toEntries(ledger.groups), groupEntry => (
							<section key={groupEntry[0]} className="py-2">
								<h3 className="break-words">
									{groupEntry[1].model} · {groupEntry[1].kind} · {groupEntry[1].mode}
								</h3>
								<p className="text-muted-foreground">{groupEntry[1].calls} attempts</p>
								<dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2">
									{Array.map(Record.toEntries(groupEntry[1].values), metricEntry => (
										<div key={metricEntry[0]} className="contents">
											<dt className="text-muted-foreground">{metricEntry[0]}</dt>
											<dd className="text-right tabular-nums">
												{Boolean.match(metricEntry[1].reported > 0, {
													onFalse: () => 'unknown',
													onTrue: () =>
														`${Boolean.match(metricEntry[0] === 'cost', {onFalse: () => '', onTrue: () => '$'})}${Number.round(metricEntry[1].total, 5)}`
												})}
												<span className="text-muted-foreground block">
													{metricEntry[1].reported}/{groupEntry[1].calls} reported
												</span>
											</dd>
										</div>
									))}
								</dl>
							</section>
						))}
					</>
				))
			)}
		</div>
	)
}

function ProviderUsage() {
	const [open, setOpen] = useState(false)
	return (
		<details className="flex-none px-4" onToggle={event => setOpen(event.currentTarget.open)}>
			<summary className="text-muted-foreground cursor-pointer py-2">Provider usage</summary>
			{open && <UsageTotals />}
		</details>
	)
}

// A button's look: filled when it names what plays now.
function variantOf(on: boolean) {
	if (on) return 'default'
	return 'outline'
}

// The tick on screen: a replay still loading shows nothing yet, so it is at the replay's start.
function shownTick(source: Source, tick: number) {
	return Option.match(source, {onNone: () => tick, onSome: replay => Number.max(replay.from, tick)})
}

function Sidebar(props: {
	actor: Option.Option<number>
	onActor: () => void
	close: () => void
	panel: 'core' | 'history'
	onPanel: (panel: 'core' | 'history') => void
	onPick: (team: number) => void
	source: Source
	team: number
	view: View
}) {
	const picked = Array.findFirst(props.view.teams, team => team.id === props.team)
	return (
		<aside className="bg-popover text-popover-foreground order-last flex h-1/2 min-h-0 flex-none flex-col border-t md:order-first md:h-full md:w-96 md:border-t-0 md:border-r">
			<header className="flex h-12 flex-none items-center gap-2 border-b px-4">
				<span className="font-medium">Signal</span>
				<Button size="sm" variant={variantOf(props.panel === 'core')} onClick={() => props.onPanel('core')}>
					Core
				</Button>
				<Button size="sm" variant={variantOf(props.panel === 'history')} onClick={() => props.onPanel('history')}>
					Chronicle
				</Button>
				<span className="text-muted-foreground ml-auto tabular-nums">
					{clockOf(shownTick(props.source, props.view.frame.tick))}
				</span>
				<Button size="icon-sm" aria-label="Close inspector" variant="ghost" onClick={props.close}>
					×
				</Button>
			</header>
			{props.panel === 'core' && (
				<>
					<div className="flex-none border-b">
						<Teams teams={props.view.teams} picked={props.team} onPick={props.onPick} />
					</div>
					<header className="flex h-9 flex-none items-center gap-2 px-4">
						<Swatch team={props.team} />
						<span>{teamName(props.team)}</span>
						<span className="text-muted-foreground">thread</span>
						{Option.getOrUndefined(
							Option.map(picked, team => <span className="text-muted-foreground ml-auto">next: {team.gate}</span>)
						)}
					</header>
					<Thread
						key={`${props.team}:${Option.getOrElse(
							Option.map(props.source, replay => replay.from),
							() => 'live'
						)}`}
						team={props.team}
						tick={shownTick(props.source, props.view.frame.tick)}
						replaying={Option.isSome(props.source)}
						status={Option.getOrUndefined(
							Option.map(
								Option.filter(picked, () => !Option.isSome(props.source)),
								team => team.status
							)
						)}
					/>
					<ProviderUsage />
				</>
			)}
			{props.panel === 'history' && (
				<>
					<header className="flex min-h-11 flex-none items-center gap-2 px-4">
						<span>
							{Option.match(props.actor, {onNone: () => 'World events', onSome: actor => `Individual #${actor}`})}
						</span>
						{Option.isSome(props.actor) && (
							<Button variant="ghost" className="ml-auto" onClick={() => props.onActor()}>
								World events
							</Button>
						)}
					</header>
					<Chronicle
						key={`${Option.getOrElse(props.actor, () => 'all')}:${Option.getOrElse(
							Option.map(props.source, replay => replay.from),
							() => 'live'
						)}`}
						actor={Option.getOrElse(props.actor, () => 'all' as const)}
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
	)
}

// The explored ground in a box at two tiles a pixel, from the box's north-west corner.
function exploredLayer(explored: View['explored'], bounds: {x0: number; x1: number; z0: number; z1: number}) {
	const layer = document.createElement('canvas')
	layer.width = Math.ceil((bounds.x1 - bounds.x0) / 2)
	layer.height = Math.ceil((bounds.z1 - bounds.z0) / 2)
	const paint = layer.getContext('2d')
	if (paint === null) return layer
	const image = paint.createImageData(layer.width, layer.height)
	for (const chunk of Record.values(explored)) {
		for (const index of Array.range(0, CHUNK * CHUNK - 1)) {
			if ((((chunk.bits[index >> 3] ?? 0) >> (index & 7)) & 1) === 1) {
				image.data.set(
					[200, 216, 176, 255],
					(Math.floor((chunk.cz * CHUNK + Math.floor(index / CHUNK) - bounds.z0) / 2) * layer.width +
						Math.floor((chunk.cx * CHUNK + (index % CHUNK) - bounds.x0) / 2)) *
						4
				)
			}
		}
	}
	paint.putImageData(image, 0, 0)
	return layer
}

// The explored ground at two tiles a pixel, the chunks each team stood in, every Home and unit, and the camera's place. A click moves the camera there.
function Minimap(props: {
	looking: () => {x: number; z: number}
	onGo: (at: {x: number; z: number}) => void
	view: View
}) {
	const canvas = useRef<HTMLCanvasElement>(null)
	const ground = useRef({canvas: document.createElement('canvas'), key: '', x0: 0, z0: 0})
	const bounds = Array.reduce(
		[
			...Array.map(Record.values(props.view.explored), chunk => ({x: chunk.cx * CHUNK, z: chunk.cz * CHUNK})),
			...Array.map(Record.values(props.view.explored), chunk => ({
				x: (chunk.cx + 1) * CHUNK,
				z: (chunk.cz + 1) * CHUNK
			}))
		],
		{x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity},
		(box, at) => ({
			x0: Number.min(box.x0, at.x),
			x1: Number.max(box.x1, at.x),
			z0: Number.min(box.z0, at.z),
			z1: Number.max(box.z1, at.z)
		})
	)
	const scale = Number.min(
		MAP.width / Number.max(1, bounds.x1 - bounds.x0 + 64),
		MAP.height / Number.max(1, bounds.z1 - bounds.z0 + 64)
	)
	const middle = {x: (bounds.x0 + bounds.x1) / 2, z: (bounds.z0 + bounds.z1) / 2}
	function toMap(at: {x: number; z: number}) {
		return {x: MAP.width / 2 + (at.x - middle.x) * scale, y: MAP.height / 2 + (at.z - middle.z) * scale}
	}
	useEffect(() => {
		const context = canvas.current?.getContext('2d')
		if (Predicate.isNullish(context) || bounds.x0 === Infinity) return
		// The explored ground redraws only when another chunk is explored or one grows.
		const key = `${props.view.explorationRevision}`
		if (key !== ground.current.key) {
			ground.current = {canvas: exploredLayer(props.view.explored, bounds), key, x0: bounds.x0, z0: bounds.z0}
		}
		context.clearRect(0, 0, MAP.width, MAP.height)
		const corner = toMap({x: ground.current.x0, z: ground.current.z0})
		context.imageSmoothingEnabled = false
		context.drawImage(
			ground.current.canvas,
			corner.x,
			corner.y,
			ground.current.canvas.width * 2 * scale,
			ground.current.canvas.height * 2 * scale
		)
		for (const zone of props.view.zones) {
			const teams = Array.filter(Array.range(0, TEAMS.length - 1), team => ((zone.teams >> team) & 1) === 1)
			const at = toMap({x: zone.cx * CHUNK, z: zone.cz * CHUNK})
			Array.forEach(teams, (team, index) => {
				context.fillStyle = `${teamColor(team)}55`
				context.fillRect(
					at.x + (CHUNK * scale * index) / teams.length,
					at.y,
					(CHUNK * scale) / teams.length,
					CHUNK * scale
				)
			})
		}
		for (const building of props.view.buildings) {
			const at = toMap({x: building.x, z: building.z})
			context.fillStyle = teamColor(building.team)
			if (building.kind === 'home') {
				context.fillRect(at.x - 3, at.y - 3, 9, 9)
				context.strokeStyle = '#ffffff'
				context.strokeRect(at.x - 3, at.y - 3, 9, 9)
			} else {
				context.fillRect(at.x, at.y, Number.max(1.5, building.w * scale), Number.max(1.5, building.d * scale))
			}
		}
		for (const unit of props.view.frame.units) {
			if (unit.team !== undefined) {
				const at = toMap(unit)
				context.fillStyle = teamColor(unit.team)
				context.fillRect(at.x - 1.5, at.y - 1.5, 3, 3)
			}
		}
		const looking = toMap(props.looking())
		context.strokeStyle = '#111111'
		context.lineWidth = 1
		context.strokeRect(looking.x - 12, looking.y - 8, 24, 16)
	})
	return (
		<canvas
			ref={canvas}
			width={MAP.width}
			height={MAP.height}
			aria-label="Map"
			className="block cursor-pointer"
			onClick={event => {
				const box = event.currentTarget.getBoundingClientRect()
				props.onGo({
					x: middle.x + (event.clientX - box.left - MAP.width / 2) / scale,
					z: middle.z + (event.clientY - box.top - MAP.height / 2) / scale
				})
			}}
		/>
	)
}

function Hints() {
	return (
		<p className="text-muted-foreground flex gap-3 border-t px-3 py-2">
			{Array.map(
				[
					{does: 'overview', key: 'Q'},
					{does: 'follow', key: ']'},
					{does: 'free', key: 'Esc'},
					{does: 'play', key: 'Space'}
				],
				hint => (
					<span key={hint.key}>
						<kbd className="text-foreground border px-1">{hint.key}</kbd> {hint.does}
					</span>
				)
			)}
		</p>
	)
}

// The followed unit: its portrait beside what it does and its health.
function Followed(props: {unit: UnitView}) {
	return (
		<div className="flex items-center gap-3 border-t p-3">
			<Portrait kind={props.unit.kind} className="size-9" />
			<div className="min-w-0 flex-1">
				<p className="flex items-center gap-1.5 first-letter:uppercase">
					{props.unit.team !== undefined && <Swatch team={props.unit.team} />}#{props.unit.id} {doingOf(props.unit)}
				</p>
				<Meter value={percent(props.unit.health)}>
					<Pips value={props.unit.health} />
				</Meter>
			</div>
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
		<section aria-label="Timeline" className="bg-popover flex-none border-t px-3 py-2">
			<details>
				<summary className="text-muted-foreground cursor-pointer">
					Replay · {clockOf(props.tick)} / {clockOf(span.live)}
					{!live && ` · ${clockOf(span.live - props.tick)} behind`}
				</summary>
				<div className="relative h-5">
					{Array.map(props.timeline.marks, (mark, index) => (
						<MarkGlyph key={index} mark={mark} span={span} />
					))}
					<span className="bg-foreground absolute inset-x-0 bottom-0 h-px" />
					<span
						className="bg-foreground absolute bottom-0 left-(--at) h-3 w-0.5 -translate-x-1/2"
						style={{'--at': percent((props.tick - span.start) / length)}}
					/>
				</div>
				<input
					className="w-full"
					aria-label="Replay time"
					type="range"
					min={span.start}
					max={span.live}
					value={props.tick}
					onChange={event => props.onSource(Option.some({from: event.currentTarget.valueAsNumber, speed: 0}))}
				/>
			</details>
			<div className="mt-1 flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="xs"
					aria-label={Boolean.match(live || speed > 0, {onFalse: () => 'Play', onTrue: () => 'Pause'})}
					onClick={() => props.onSource(toggled(props.source, props.tick))}
				>
					{Boolean.match(live || speed > 0, {onFalse: () => '▶', onTrue: () => '❚❚'})}
				</Button>
				{Array.map(SPEEDS, entry => (
					<Button
						key={entry}
						variant={variantOf(!live && speed === entry)}
						size="xs"
						onClick={() => props.onSource(Option.some({from: props.tick, speed: entry}))}
					>
						{entry}×
					</Button>
				))}
				<span className="ml-auto tabular-nums max-sm:hidden">
					{clockOf(props.tick)}
					<span className="text-muted-foreground">
						{' '}
						/ {clockOf(span.live)}
						{!live && ` · ${clockOf(span.live - props.tick)} behind`}
					</span>
				</span>
				<Button variant={variantOf(live)} size="xs" onClick={() => props.onSource(Option.none())}>
					<i className={cn('size-1.5 rounded-full', live && 'bg-destructive', !live && 'bg-muted-foreground')} />
					live
				</Button>
			</div>
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
		<div className="bg-popover text-popover-foreground absolute bottom-4 left-0 w-64 -translate-x-1/2 border p-2.5">
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
						<>
							<p>{String.capitalize(field.material)} ore</p>
							<p className="text-muted-foreground mt-1">
								{field.left.toLocaleString('en')} of {field.total.toLocaleString('en')} left, {field.tiles} tiles
							</p>
						</>
					)
				)
			)}
			{Option.getOrUndefined(
				Option.map(
					Option.flatMap(
						Option.filter(props.info, () => Option.isNone(props.building)),
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
					render={
						<a
							aria-label="Sign in with GitHub"
							href={`https://auth.mp281x.xyz/auth/github?${new URLSearchParams({next: location.href})}`}
						/>
					}
				>
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
		const frame = world.renderer.fit([home, ...unitsOf(view.frame.units, team)])
		return {
			key: `overview:${team}`,
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
function Overlay(props: {buildings: View['buildings']; units: View['frame']['units']}) {
	const ground = useAtomValue(groundAtom)
	const hover = useAtomValue(hoverAtom)
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
			{(Option.isSome(hovered) || Option.isSome(ground.info)) && Option.isNone(hover) && (
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

// The world view and everything over it: the canvas belongs to the renderer, and frames reach it through the registry, not React.
function World(props: {seed: number; view: View}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [world, setWorld] = useState(Option.none<{cast: Cast; renderer: Renderer}>)
	// The tile under the pointer, what the chunk worker said lies on it, and the pointer's place on screen.
	const setGround = useAtomSet(groundAtom)
	const [follow, setFollow] = useAtom(followAtom)
	const [team, setTeam] = useAtom(teamAtom)
	const [source, setSource] = useAtom(sourceAtom)
	const [panel, setPanel] = useState(() => Option.some<'core' | 'history'>('core'))
	const timeline = useAtomValue(timelineAtom)

	const [portraits, setPortraits] = useState<Record<string, string>>({})
	// What the key handler and the camera read, kept current outside render.
	const latest = useRef({source, view: props.view})
	useEffect(() => {
		latest.current = {source, view: props.view}
	}, [source, props.view])

	useEffect(() => {
		if (canvas.current === null) return
		const renderer = createRenderer(canvas.current, props.seed)
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
			renderer.fog(!current.overview)
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
			registry.set(followAtom, {
				free: Option.none(),
				id: Option.map(Array.get(own, (((index + step) % own.length) + own.length) % own.length), unit => unit.id),
				overview: false
			})
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
			left: () => renderer.turn(-1),
			next: () => cycle(1),
			out: () => renderer.zoomBy(ZOOM_STEP),
			overview: () =>
				registry.set(followAtom, {...registry.get(followAtom), overview: !registry.get(followAtom).overview}),
			play: () =>
				registry.set(
					sourceAtom,
					toggled(latest.current.source, shownTick(latest.current.source, latest.current.view.frame.tick))
				),
			previous: () => cycle(-1),
			right: () => renderer.turn(1)
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
		setPanel(Option.some('history'))
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
			setPanel(Option.some('history'))
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
				<div className="absolute inset-0 flex flex-col md:flex-row">
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
							<Overlay buildings={props.view.buildings} units={props.view.frame.units} />

							<Panel label="Map controls" className="top-2 left-2 flex items-center gap-1 px-2 md:top-4 md:left-4">
								<Button
									aria-label="Open inspector"
									variant="ghost"
									size="icon"
									onClick={() => setPanel(Option.some('core'))}
								>
									☰
								</Button>
								<Button
									aria-label="Zoom in"
									variant="ghost"
									size="icon"
									onClick={() =>
										Option.match(world, {
											onNone: () => undefined,
											onSome: active => active.renderer.zoomBy(1 / ZOOM_STEP)
										})
									}
								>
									+
								</Button>
								<Button
									aria-label="Zoom out"
									variant="ghost"
									size="icon"
									onClick={() =>
										Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.zoomBy(ZOOM_STEP)})
									}
								>
									−
								</Button>
								<Button
									aria-label="Rotate map"
									variant="ghost"
									size="icon"
									onClick={() =>
										Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.turn(1)})
									}
								>
									↻
								</Button>
								<Button
									aria-label="Team overview"
									variant="ghost"
									size="icon"
									onClick={() => setFollow({...follow, overview: !follow.overview})}
								>
									⌖
								</Button>
								<span className="text-muted-foreground pl-2">
									{Boolean.match(props.view.frame.paused === true, {
										onFalse: () => 'Spectator',
										onTrue: () => 'Stopped'
									})}
								</span>
							</Panel>
							<Panel label="Map" className="top-4 right-4 hidden w-94.5 lg:block">
								{Option.getOrUndefined(
									Option.map(world, active => (
										<Minimap
											view={props.view}
											looking={active.renderer.looking}
											onGo={at => setFollow({free: Option.some(at), id: Option.none(), overview: false})}
										/>
									))
								)}
								{Option.getOrUndefined(
									Option.map(
										Array.findFirst(props.view.frame.units, unit => Option.contains(follow.id, unit.id)),
										unit => <Followed unit={unit} />
									)
								)}
								<Hints />
							</Panel>
							{Option.getOrUndefined(
								Option.map(source, replay => (
									<Panel className="top-16 left-2 px-3 py-1.5 md:left-4">
										Replay {clockOf(shownTick(source, props.view.frame.tick))}
										<span className="text-muted-foreground"> · {replay.speed}×</span>
									</Panel>
								))
							)}

							{props.view.count === 0 && <Status>Loading the replay</Status>}
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
					{Option.getOrUndefined(
						Option.map(panel, pickedPanel => (
							<Sidebar
								actor={follow.id}
								onActor={() => setFollow({...follow, id: Option.none()})}
								panel={pickedPanel}
								onPanel={next => setPanel(Option.some(next))}
								close={() => setPanel(Option.none())}
								view={props.view}
								team={team}
								source={source}
								onPick={next => {
									setTeam(next)
									setFollow({free: Option.none(), id: Option.none(), overview: follow.overview})
								}}
							/>
						))
					)}
				</div>
			</Portraits>
		</Navigation>
	)
}

function Signal() {
	const result = useAtomValue(hudAtom)
	return (
		<main className="relative h-dvh w-dvw overflow-hidden font-mono text-xs select-none">
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
