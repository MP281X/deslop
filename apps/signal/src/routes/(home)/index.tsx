import {RegistryContext, useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, Predicate, Record, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import type {PointerEvent, ReactNode, WheelEvent} from 'react'
import {createContext, useContext, useEffect, useRef, useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'
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
	liveThreadAtom,
	pastThreadAtom,
	seedAtom,
	sourceAtom,
	teamAtom,
	timelineAtom,
	viewAtom
} from '#lib/utils.ts'
import type {Follow, Source, View} from '#lib/utils.ts'
import {ROUND, TEAMS, TICK_HZ} from '#services/game/lib/utils.ts'
import type {BuildingView, Entry, Mark, TeamView, Timeline, UnitView} from '#services/game/schema.ts'
import {UnitKind} from '#services/game/schema.ts'

const ZOOM_STEP = 1.25
// The replay speeds, in multiples of real time.
const SPEEDS = [1, 10, 30]
// The minimap's size in pixels.
const MAP = {height: 220, width: 376}
// A chunk's side in tiles, as the minimap draws explored ground at two tiles a pixel.
const CHUNK = 32

type Key =
	| 'in'
	| 'leave'
	| 'left'
	| 'next'
	| 'out'
	| 'overview'
	| 'play'
	| 'previous'
	| 'right'
	| 'team0'
	| 'team1'
	| 'team2'

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
	if (code === 'Digit1') return Option.some<Key>('team0')
	if (code === 'Digit2') return Option.some<Key>('team1')
	if (code === 'Digit3') return Option.some<Key>('team2')
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
	if (event.key === 'Tab' && event.shiftKey) return Option.some<Key>('previous')
	if (event.key === 'Tab') return Option.some<Key>('next')
	return Option.orElse(letterKey(event.code, event.repeat), () => symbolKey(event.key))
}

// Each model's portrait, painted by the cast as the models load.
const Portraits = createContext<Record<string, string>>({})

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

function Pips(props: {hostile?: boolean; value: number}) {
	return (
		<span className="grid h-1 grid-cols-5 gap-px" aria-label={`${percent(props.value)} health`}>
			{Array.map(Array.range(0, 4), index => (
				<i key={index} className="bg-input relative">
					<i
						className={cn(
							'absolute inset-y-0 left-0 w-(--fill)',
							props.hostile === true && 'bg-destructive',
							props.hostile !== true && 'bg-foreground'
						)}
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
		<table className="w-full tabular-nums">
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
						onClick={() => props.onPick(team.id)}
						title={`${team.model} · next: ${team.gate}`}
						className={cn('hover:bg-accent cursor-pointer', team.id === props.picked && 'bg-accent')}
					>
						<td className="py-1.5 pl-4">
							<span className="flex items-center gap-2">
								<Swatch team={team.id} />
								{team.name}
								<kbd className="text-muted-foreground">{team.id + 1}</kbd>
							</span>
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

function Outcome(props: {outcome: Entry['commands'][number]}) {
	return (
		<li className="flex flex-col gap-1">
			<span className="flex gap-2">
				<span className={cn('w-3 flex-none text-center', !props.outcome.ok && 'text-destructive')}>
					{Boolean.match(props.outcome.ok, {onFalse: () => '✕', onTrue: () => '✓'})}
				</span>
				<span className={cn(!props.outcome.ok && 'text-destructive')}>
					{/* What the command asked for, in a few words. */}
					{Match.valueTags(props.outcome.command, {
						Advance: () => 'Pay the next milestone',
						Build: build => `Build ${String.replaceAll('_', ' ')(build.kind)} at (${build.x}, ${build.z})`,
						Cancel: cancel => `Cancel #${cancel.building}`,
						Craft: craft => `Craft ${craft.count} × ${String.replaceAll('_', ' ')(craft.recipe)}`,
						Make: make => `Make a ${make.unit}`,
						Message: message => `Message ${teamName(message.team)}`,
						Note: () => 'Update notes',
						Order: order =>
							`${order.order._tag} ${Array.join(
								Array.map(order.units, id => `#${id}`),
								' '
							)}`,
						Recipe: recipe => `Set #${recipe.building} to ${String.replaceAll('_', ' ')(recipe.recipe)}`,
						Upgrade: upgrade => `Upgrade #${upgrade.unit}`
					})}
					<span className="text-muted-foreground"> · {props.outcome.text}</span>
				</span>
			</span>
			{props.outcome.command._tag === 'Message' && (
				<span className="ml-5 border px-3 py-2 leading-relaxed">
					<span className="mb-1 flex items-center gap-1.5">
						→ <Swatch team={props.outcome.command.team} />
						{teamName(props.outcome.command.team)}
					</span>
					{props.outcome.command.text}
				</span>
			)}
		</li>
	)
}

// One round of a team's thread: when, what it was told, what it thought and said, and what each command did.
function Round(props: {entry: Entry}) {
	return (
		<li className="flex flex-col gap-2 border-t pt-3">
			<header className="text-muted-foreground flex items-center gap-2">
				<span>{clockOf(props.entry.tick)}</span>
				<span>round {props.entry.round}</span>
				{props.entry.status !== 'done' && <span className="text-destructive">{props.entry.status}</span>}
				{Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(props.entry.tokens), tokens => (
						<span className="ml-auto">{Number.round((tokens.input + tokens.output) / 1000, 1)}k tok</span>
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
					<p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{String.trim(reasoning)}</p>
				))
			)}
			{String.isNonEmpty(String.trim(props.entry.text)) && (
				<p className="leading-relaxed whitespace-pre-wrap">{String.trim(props.entry.text)}</p>
			)}
			{Array.isReadonlyArrayNonEmpty(props.entry.commands) && (
				<ul className="flex flex-col gap-1">
					{Array.map(props.entry.commands, (outcome, index) => (
						<Outcome key={index} outcome={outcome} />
					))}
				</ul>
			)}
			<details>
				<summary className="text-muted-foreground cursor-pointer">What it read</summary>
				<pre className="text-muted-foreground mt-2 font-mono leading-relaxed whitespace-pre-wrap">
					{props.entry.observation}
				</pre>
			</details>
		</li>
	)
}

// A team's thread, read-only: newest at the bottom, pinned there while the reader is. Live, it keeps fresh; in a replay, it ends at the replay's round.
function Thread(props: {replaying: boolean; status?: TeamView['status']; team: number; tick: number}) {
	const list = useRef<HTMLOListElement>(null)
	const pinned = useRef(true)
	const result = useAtomValue(
		Boolean.match(props.replaying, {
			onFalse: () => liveThreadAtom(props.team),
			onTrue: () => pastThreadAtom(`${props.team}:${Math.floor(props.tick / ROUND) + 1}`)
		})
	)
	const entries = Option.getOrElse(AsyncResult.value(result), () => [])
	// Runs after every render: the list stays at its newest while the reader is there.
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
			className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 select-text"
		>
			{Array.isReadonlyArrayEmpty(entries) && (
				<li className="text-muted-foreground pt-3">
					{Boolean.match(AsyncResult.isWaiting(result), {
						onFalse: () => 'Nothing yet: the first round ends 30 seconds in.',
						onTrue: () => 'Loading…'
					})}
				</li>
			)}
			{Array.map(entries, entry => (
				<Round key={entry.round} entry={entry} />
			))}
			{props.status === 'thinking' && (
				<li className="text-muted-foreground flex items-center gap-2 border-t pt-3">
					<Spinner variant="subtle" className="size-3" />
					<span className="motion-safe:animate-pulse">Thinking</span>
				</li>
			)}
		</ol>
	)
}

// The left column: the teams, then the picked team's thread.
function Sidebar(props: {onPick: (team: number) => void; replaying: boolean; team: number; view: View}) {
	const picked = Array.findFirst(props.view.teams, team => team.id === props.team)
	return (
		<aside className="bg-popover text-popover-foreground absolute inset-y-0 left-0 flex w-96 flex-col border-r">
			<header className="flex h-10 flex-none items-center gap-2 border-b px-4">
				<span className="font-medium">Signal</span>
				<span className="text-muted-foreground">{props.view.teams.length} teams</span>
				<span className="text-muted-foreground ml-auto tabular-nums">{clockOf(props.view.frame.tick)}</span>
			</header>
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
				key={`${props.team}:${props.replaying}`}
				team={props.team}
				tick={props.view.frame.tick}
				replaying={props.replaying}
				status={Option.getOrUndefined(
					Option.map(
						Option.filter(picked, () => !props.replaying),
						team => team.status
					)
				)}
			/>
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
	const keys = Record.keys(props.view.explored)
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
		const key = `${keys.length}:${Array.reduce(Record.values(props.view.explored), 0, (sum, chunk) => sum + (chunk.bits[0] ?? 0) + (chunk.bits[64] ?? 0))}`
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
					{does: 'follow', key: 'Tab'},
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

// The tick on screen: a replay still loading shows nothing yet, so it is at the replay's start.
function shownTick(source: Source, tick: number) {
	return Option.match(source, {onNone: () => tick, onSome: replay => Number.max(replay.from, tick)})
}

// A button's look: filled when it names what plays now.
function variantOf(on: boolean) {
	if (on) return 'default'
	return 'outline'
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
	function seek(event: PointerEvent<HTMLDivElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const share = Number.clamp((event.clientX - box.left) / box.width, {maximum: 1, minimum: 0})
		if (share > 0.995) props.onSource(Option.none())
		else props.onSource(Option.some({from: Number.round(span.start + share * length, 0), speed: Number.max(1, speed)}))
	}
	return (
		<Panel label="Timeline" className="right-4 bottom-4 left-100 px-3 pt-2 pb-2">
			<div className="relative h-5 cursor-pointer" onPointerDown={seek}>
				{Array.map(props.timeline.marks, (mark, index) => (
					<MarkGlyph key={index} mark={mark} span={span} />
				))}
				<span className="bg-foreground absolute inset-x-0 bottom-0 h-px" />
				<span
					className="bg-foreground absolute bottom-0 left-(--at) h-3 w-0.5 -translate-x-1/2"
					style={{'--at': percent((props.tick - span.start) / length)}}
				/>
			</div>
			<div className="mt-2 flex items-center gap-2">
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
				<span className="ml-auto tabular-nums">
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
		</Panel>
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
					<Pips value={props.unit.health} hostile={props.unit.team === undefined} />
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
		<Panel className="bottom-4 left-1/2 -translate-x-1/2 px-3 py-2">
			<p className="text-muted-foreground">{props.children}</p>
		</Panel>
	)
}

function SignIn() {
	return (
		<Panel label="Sign in" className="top-1/2 left-1/2 w-80 -translate-1/2">
			<p className="p-3 font-medium">Signal</p>
			<p className="text-muted-foreground px-3 pb-3 leading-relaxed">
				Three AI teams each build a factory from nothing on one endless world. You watch.
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
				Option.flatMap(follow.id, id => Option.map(world.cast.positionOf(id), at => ({at, id}))),
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
	ground: {at: Option.Option<{x: number; z: number}>; info: Option.Option<Inspected>; x: number; y: number}
	units: View['frame']['units']
}) {
	const hover = useAtomValue(hoverAtom)
	const hovered = Option.flatMap(props.ground.at, at => buildingAt(props.buildings, at))
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			{Array.map(
				Array.filter(props.units, unit => unit.health < 0.999 && unit.act !== 'die' && isUnit(unit.kind)),
				unit => (
					<div key={unit.id} data-follow={unit.id} data-pips hidden className="absolute top-0 left-0">
						<div className="bg-popover/90 -mt-5 -ml-5 w-10 border p-0.5">
							<Pips value={unit.health} hostile={unit.team === undefined} />
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
			{(Option.isSome(hovered) || Option.isSome(props.ground.info)) && Option.isNone(hover) && (
				<div
					className="absolute top-(--y) left-(--x)"
					style={{'--x': `${props.ground.x}px`, '--y': `${props.ground.y}px`}}
				>
					<GroundCard building={hovered} info={props.ground.info} />
				</div>
			)}
		</div>
	)
}

// The world view and everything over it: the canvas belongs to the renderer, and frames reach it through the registry, not React.
function World(props: {seed: number; view: View}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [world, setWorld] = useState(Option.none<{cast: Cast; renderer: Renderer}>)
	const setHover = useAtomSet(hoverAtom)
	// The tile under the pointer, what the chunk worker said lies on it, and the pointer's place on screen.
	const [ground, setGround] = useState({
		at: Option.none<{x: number; z: number}>(),
		info: Option.none<Inspected>(),
		x: 0,
		y: 0
	})
	const [follow, setFollow] = useAtom(followAtom)
	const [team, setTeam] = useAtom(teamAtom)
	const [source, setSource] = useAtom(sourceAtom)
	const timeline = useAtomValue(timelineAtom)
	// A press on the world: how far it has dragged and where the pointer was; -1 while nothing is pressed.
	const drag = useRef({moved: -1, x: 0, y: 0})
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
				info: Option.liftPredicate(answer, entry => entry.field !== undefined || entry.prop !== undefined)
			}))
		)
		const seen: {count: number; zones: View['zones']} = {count: 0, zones: []}
		const frames = registry.subscribe(
			viewAtom,
			result => {
				const view = Option.getOrUndefined(AsyncResult.value(result))
				if (view === undefined || view.count === 0) return
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
				cast.frame(view.frame)
				// The camera always has a unit of the team to follow unless the player set it free: the first, or the next once the followed one is gone.
				const current = registry.get(followAtom)
				const own = unitsOf(view.frame.units, registry.get(teamAtom))
				if (Option.isNone(current.free) && !Array.some(own, unit => Option.contains(current.id, unit.id))) {
					registry.set(followAtom, {...current, id: Option.map(Array.head(own), unit => unit.id)})
				}
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
			right: () => renderer.turn(1),
			team0: () => pick(0),
			team1: () => pick(1),
			team2: () => pick(2)
		} satisfies Record<Key, () => void>
		function keys(event: KeyboardEvent) {
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
	}, [registry, props.seed])

	function followUnit(id: number) {
		const unit = Option.getOrUndefined(Array.findFirst(props.view.frame.units, entry => entry.id === id))
		if (unit?.team === undefined) return
		setTeam(unit.team)
		setFollow({free: Option.none(), id: Option.some(id), overview: false})
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.centre()})
	}

	// A press starts a drag that pans the view; let go without dragging, it is a click.
	function down(event: PointerEvent<HTMLCanvasElement>) {
		event.currentTarget.setPointerCapture(event.pointerId)
		drag.current = {moved: 0, x: event.clientX, y: event.clientY}
	}

	function up(event: PointerEvent<HTMLCanvasElement>) {
		const dragged = drag.current.moved > 4
		drag.current = {moved: -1, x: 0, y: 0}
		if (dragged) return
		// A click on a team's unit follows it.
		Option.match(
			Option.filter(
				Option.flatMap(world, active => active.cast.pick(event.clientX, event.clientY)),
				id => Array.some(props.view.frame.units, unit => unit.id === id && unit.team !== undefined)
			),
			{onNone: () => undefined, onSome: followUnit}
		)
	}

	function move(event: PointerEvent<HTMLCanvasElement>) {
		if (drag.current.moved >= 0) {
			const dx = event.clientX - drag.current.x
			const dy = event.clientY - drag.current.y
			drag.current = {moved: drag.current.moved + Math.hypot(dx, dy), x: event.clientX, y: event.clientY}
			Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.pan(dx, dy)})
			return
		}
		Option.match(world, {
			onNone: () => undefined,
			onSome: active => {
				const picked = active.cast.pick(event.clientX, event.clientY)
				setHover(Option.map(picked, id => ({id: `${id}`, x: event.clientX, y: event.clientY})))
				// Off the units, the ground under the pointer: the building on it from the frames, the rest from the chunk worker.
				const at = Option.filter(active.renderer.inspect(event.clientX, event.clientY), () => Option.isNone(picked))
				setGround(before => ({
					at,
					info: Option.filter(before.info, () => Option.isSome(at)),
					x: event.clientX,
					y: event.clientY
				}))
			}
		})
	}

	function wheel(event: WheelEvent<HTMLCanvasElement>) {
		Option.match(world, {
			onNone: () => undefined,
			onSome: active => active.renderer.zoomBy(Math.exp(event.deltaY * wheelRate(event.ctrlKey)))
		})
	}

	return (
		<Portraits value={portraits}>
			<div className="absolute inset-0">
				<canvas
					ref={canvas}
					aria-label="Signal"
					className="absolute inset-0 size-full touch-none"
					onPointerDown={down}
					onPointerUp={up}
					onPointerMove={move}
					onPointerLeave={() => {
						setHover(Option.none())
						setGround(before => ({...before, at: Option.none(), info: Option.none()}))
					}}
					onWheel={wheel}
				/>
				<Overlay ground={ground} buildings={props.view.buildings} units={props.view.frame.units} />
				<Sidebar
					view={props.view}
					team={team}
					replaying={Option.isSome(source)}
					onPick={next => {
						setTeam(next)
						setFollow({free: Option.none(), id: Option.none(), overview: follow.overview})
					}}
				/>
				<Panel label="Map" className="top-4 right-4 w-94.5">
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
						<Panel className="top-4 left-1/2 ml-48 -translate-x-1/2 px-3 py-1.5">
							Replay {clockOf(props.view.frame.tick)}
							<span className="text-muted-foreground"> · {replay.speed}×</span>
						</Panel>
					))
				)}
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
				{props.view.count === 0 && <Status>Loading the replay</Status>}
			</div>
		</Portraits>
	)
}

function Signal() {
	const result = useAtomValue(viewAtom)
	return (
		<main className="relative h-dvh w-dvw overflow-hidden font-mono text-xs select-none">
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
				onSome: known => <World seed={known} view={Option.getOrElse(AsyncResult.value(result), () => EMPTY)} />
			})}
		</main>
	)
}

export const Route = createFileRoute('/(home)/')({component: Signal})
