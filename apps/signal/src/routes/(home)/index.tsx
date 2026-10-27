import {RegistryContext, useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, HashMap, Number, Option, Order, Schema, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import type {ReactNode} from 'react'
import {useContext, useEffect, useRef, useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Input} from '@deslop/components-web/ui/input'
import {cn} from '@deslop/components-web/utils'

import {MARKS, createRenderer} from './-renderer.ts'

import {actAtom, askAtom, focusAtom, jumpAtom, steerAtom, viewAtom} from '#lib/utils.ts'
import type {Focus, View} from '#lib/utils.ts'
import {CODES, STATS, STRIDE} from '#services/game/lib/utils.ts'
import {DroneKind, MemoryEntry} from '#services/game/schema.ts'
import type {EntityInfo, Hud, LogEntry, Point} from '#services/game/schema.ts'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const KEYS = [
	['Tab', 'next drone'],
	['F', 'fly it'],
	['Q', 'overview'],
	['/', 'ask CORE']
] as const
type Section = typeof Section.Type
const Section = Schema.Literals(['players', 'places', 'routes', 'notes'])

type Search = typeof Search.Type
const Search = Schema.Struct({invite: Schema.optionalKey(Schema.String)})

export const Route = createFileRoute('/(home)/')({
	component: Signal,
	validateSearch: search => Option.getOrElse(Schema.decodeOption(Search)(search), () => Search.make({}))
})

const byGroup = Order.mapInput(
	Order.Tuple([Order.String, Order.Number]),
	(info: EntityInfo) => [info.group, info.id] as const
)

function Signal() {
	const invite = Route.useSearch().invite ?? ''
	return (
		<main className="relative h-dvh w-dvw overflow-hidden font-mono text-xs select-none">
			<Viewport invite={invite} />
			{AsyncResult.match(useAtomValue(viewAtom(invite)), {
				onFailure: failure =>
					Option.match(
						Option.filter(AsyncResult.error(failure), error => error._tag === 'AuthError'),
						{onNone: () => <Status>signal lost · reconnecting</Status>, onSome: () => <SignIn />}
					),
				onInitial: () => <Status>acquiring signal</Status>,
				onSuccess: success =>
					Option.match(success.value.hud, {
						onNone: () => <Status>acquiring signal</Status>,
						onSome: hud => <Overlay hud={hud} view={success.value} />
					})
			})}
		</main>
	)
}

// The canvas belongs to the renderer: frames reach it through the registry, never through React renders.
function Viewport(props: {invite: string}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const labels = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (canvas.current === null || labels.current === null) return
		const renderer = createRenderer(canvas.current, {
			focus: focus => registry.set(focusAtom, focus),
			labels: labels.current,
			steer: steer => registry.set(steerAtom, {payload: steer})
		})
		const views = registry.subscribe(
			viewAtom(props.invite),
			result => {
				if (AsyncResult.isSuccess(result)) renderer.setView(result.value)
			},
			{immediate: true}
		)
		const jumps = registry.subscribe(jumpAtom, jump => renderer.focus(jump.drone))
		return () => {
			views()
			jumps()
			renderer.dispose()
		}
	}, [registry, props.invite])
	return (
		<>
			<canvas ref={canvas} className="absolute inset-0 size-full" />
			<div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden" />
		</>
	)
}

function Panel(props: {children: ReactNode; className?: string; label?: string}) {
	return (
		<section aria-label={props.label} className={cn('bg-background/85 absolute', props.className)}>
			{props.children}
		</section>
	)
}

function Key(props: {children: ReactNode}) {
	return (
		<kbd className="text-foreground border-foreground/30 inline-grid h-5 min-w-5 place-items-center border px-1">
			{props.children}
		</kbd>
	)
}

function Bar(props: {alert?: boolean; filled: number; of: number}) {
	return (
		<span className="flex gap-px" aria-label={`${props.filled} of ${props.of}`}>
			{Array.makeBy(props.of, index => (
				<i
					key={index}
					className={cn(
						'bg-foreground/15 h-1.5 w-1',
						index < props.filled && 'bg-foreground/70',
						index < props.filled && props.alert === true && 'bg-destructive'
					)}
				/>
			))}
		</span>
	)
}

// Places read as distance and compass bearing from what you are looking at, never as raw coordinates; north is -z.
function whereFrom(origin: Point, at: Point) {
	const distance = Math.hypot(at.x - origin.x, at.z - origin.z)
	if (distance < 3) return 'here'
	const sector = Number.round(Math.atan2(at.x - origin.x, origin.z - at.z) / (Math.PI / 4), 0)
	return `${Number.round(distance, 0)} m ${COMPASS[(sector + 8) % 8] ?? 'N'}`
}

function ago(time: number, now: number) {
	const seconds = Number.max(0, Number.round((now - time) / 1000, 0))
	if (seconds < 60) return `${seconds}s`
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
	return `${Math.floor(seconds / 3600)}h`
}

function Status(props: {children: ReactNode}) {
	return (
		<Panel className="bottom-6 left-1/2 -translate-x-1/2 px-3 py-2">
			<p className="text-muted-foreground tracking-widest uppercase">
				<span className="text-primary">● </span>
				{props.children}
			</p>
		</Panel>
	)
}

// Signed out, the world flies by behind one panel: what this is, its four keys, and the way in, which returns here.
function SignIn() {
	return (
		<Panel label="Sign in" className="top-1/2 left-1/2 w-80 -translate-1/2 border">
			<header className="text-muted-foreground flex items-baseline justify-between px-3 pt-2.5 pb-1.5 tracking-widest uppercase">
				<span>Signal</span>
				<span className="text-primary">▸</span>
			</header>
			<p className="text-muted-foreground px-3 pb-3 leading-relaxed">
				Hop between your drones and fly any of them. CORE runs the fleet on one shared world while you are away.
			</p>
			<ul className="border-t px-3 py-2">
				{Array.map(KEYS, entry => (
					<li key={entry[0]} className="flex items-center gap-3 py-1">
						<span className="w-8">
							<Key>{entry[0]}</Key>
						</span>
						<span className="text-muted-foreground">{entry[1]}</span>
					</li>
				))}
			</ul>
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

type Unit = {health: number; x: number; z: number}

// A drone is in trouble when its hull is low or an alert named it in the last 20 seconds.
function troubled(id: number, health: number, log: Hud['log'], now: number) {
	return (
		health < 0.35 || Array.some(log, entry => entry.tone === 'alert' && entry.drone === id && now - entry.time < 20_000)
	)
}

function Overlay(props: {hud: Hud; view: View}) {
	const focus = useAtomValue(focusAtom)
	// Health and position of every visible unit, from the frame's packed records.
	const units = HashMap.fromIterable(
		Array.map(
			Array.chunksOf(Array.fromIterable(props.view.positions), STRIDE),
			record => [record[0] ?? 0, {health: record[4] ?? 0, x: record[1] ?? 0, z: record[2] ?? 0} satisfies Unit] as const
		)
	)
	const fleet = Array.sort(
		Array.filter(
			Array.fromIterable(HashMap.values(props.view.info)),
			info => info.owner === props.hud.you && info.kind !== 'glitch' && STATS[info.kind].speed > 0
		),
		byGroup
	)
	const focused = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(focus.drone), id => HashMap.get(props.view.info, id))
	)
	const unit = Option.getOrUndefined(
		Option.flatMap(Option.fromUndefinedOr(focused), info => HashMap.get(units, info.id))
	)
	// Distances count from the focused drone, or from the base when nothing is focused.
	const origin = unit ?? props.hud.base
	return (
		<>
			<Feed log={props.hud.log} now={props.view.at} origin={origin} />
			<Rail fleet={fleet} focused={focus.drone} log={props.hud.log} now={props.view.at} units={units} />
			{!focus.overview && focused !== undefined && unit !== undefined && (
				<Readout base={props.hud.base} focus={focus} info={focused} unit={unit} />
			)}
			{focus.overview && <Intel hud={props.hud} now={props.view.at} origin={origin} />}
			<Ask drone={focus.drone} offline={props.hud.core.planner === 'offline'} />
			<Hints focus={focus} />
		</>
	)
}

// Alerts stay a minute unless dismissed or followed; other events pass in six seconds.
function lingers(entry: LogEntry, now: number) {
	if (entry.tone === 'alert') return now - entry.time < 60_000
	return now - entry.time < 6000
}

// A row jumps to its drone and leaves the feed.
function Feed(props: {log: Hud['log']; now: number; origin: Point}) {
	const [dismissed, setDismissed] = useState<number[]>([])
	const jump = useAtomSet(jumpAtom)
	return (
		<ol
			aria-label="Events"
			className="absolute top-4 left-1/2 flex w-full max-w-xl -translate-x-1/2 flex-col gap-px px-4"
		>
			{Array.map(
				Array.takeRight(
					Array.filter(props.log, entry => !Array.contains(dismissed, entry.time) && lingers(entry, props.now)),
					3
				),
				entry => (
					<li key={`${entry.time}${entry.text}`}>
						<Button
							variant="ghost"
							size="xs"
							className={cn(
								'bg-background/85 h-auto w-full justify-start gap-2 px-3 py-1.5',
								entry.tone === 'alert' && 'bg-destructive/20 text-destructive'
							)}
							onClick={() => {
								setDismissed(current => Array.append(current, entry.time))
								if (entry.drone !== undefined) jump(current => ({at: current.at + 1, drone: entry.drone ?? 0}))
							}}
						>
							<span>■</span>
							{entry.text}
							<span className="text-muted-foreground ml-auto">
								{Array.join(
									[
										...Array.map(Option.toArray(Option.fromUndefinedOr(entry.at)), at => whereFrom(props.origin, at)),
										ago(entry.time, props.now)
									],
									' · '
								)}
							</span>
						</Button>
					</li>
				)
			)}
		</ol>
	)
}

function Rail(props: {
	fleet: EntityInfo[]
	focused?: number
	log: Hud['log']
	now: number
	units: HashMap.HashMap<number, Unit>
}) {
	const jump = useAtomSet(jumpAtom)
	return (
		<nav aria-label="Fleet" className="bg-background/85 absolute top-1/2 left-4 flex -translate-y-1/2 flex-col py-1">
			{Array.map(props.fleet, member => {
				const health = Option.getOrElse(
					Option.map(HashMap.get(props.units, member.id), unit => unit.health),
					() => 1
				)
				return (
					<Button
						key={member.id}
						variant="ghost"
						size="xs"
						title={`${member.kind} · ${member.routine}`}
						className={cn('justify-start gap-2 px-2', member.id === props.focused && 'text-primary')}
						onClick={() => jump(current => ({at: current.at + 1, drone: member.id}))}
					>
						<span className="w-2">{member.id === props.focused && '▸'}</span>
						<span className="w-10 text-left">
							{CODES[member.kind]}-{member.id}
						</span>
						<Bar alert={health < 0.35} filled={Math.ceil(health * 5)} of={5} />
						<span
							className={cn(
								'bg-destructive size-1.5 rounded-full',
								!troubled(member.id, health, props.log, props.now) && 'invisible'
							)}
						/>
					</Button>
				)
			})}
		</nav>
	)
}

function Readout(props: {base: Point; focus: Focus; info: EntityInfo; unit: Unit}) {
	const cargo = STATS[props.info.kind].cargo
	const where = whereFrom(props.base, props.unit)
	return (
		<Panel label="Focused drone" className="bottom-4 left-4 flex w-72 flex-col gap-1.5 px-3 py-2.5">
			<p className="flex items-baseline gap-2">
				<span className="text-primary text-sm">
					{CODES[props.info.kind]}-{props.info.id}
				</span>
				<span className="text-muted-foreground">{props.info.kind}</span>
				<span className="text-muted-foreground ml-auto">
					{Boolean.match(props.focus.controlled, {onFalse: () => 'following', onTrue: () => 'flying'})}
				</span>
			</p>
			<p className="flex items-center gap-2">
				<span className="text-muted-foreground">hull</span>
				<Bar alert={props.unit.health < 0.35} filled={Math.ceil(props.unit.health * 12)} of={12} />
				<span className={cn('ml-auto', props.unit.health < 0.35 && 'text-destructive')}>
					{Number.round(props.unit.health * 100, 0)}%
				</span>
			</p>
			<p className="text-muted-foreground">
				{Array.join(
					[
						String.toLowerCase(props.info.routine),
						Boolean.match(where === 'here', {onFalse: () => `${where} of base`, onTrue: () => 'at base'}),
						...Array.filter([`cargo ${Number.round(props.info.cargo, 0)}/${cargo}`], () => cargo > 0)
					],
					' · '
				)}
			</p>
		</Panel>
	)
}

type Row = {detail: string; hostile: boolean; keys: string[]; mark: string; name: string; section: Section}

// Memory reads as one row per subject: a player's standing and last sighting merge, then places, then raided routes.
function rowsOf(memory: MemoryEntry[], origin: Point, now: number) {
	const standings = Array.filter(memory, MemoryEntry.isAnyOf(['Standing']))
	const sightings = Array.filter(memory, MemoryEntry.isAnyOf(['Sighting']))
	const players = Array.map(
		Array.dedupe(Array.map([...standings, ...sightings], entry => String.toLowerCase(entry.player))),
		player => {
			const standing = Array.findFirst(standings, entry => String.toLowerCase(entry.player) === player)
			const sighting = Array.findFirst(sightings, entry => String.toLowerCase(entry.player) === player)
			const stance = Option.getOrElse(
				Option.map(standing, entry => entry.stance),
				() => 'met'
			)
			return {
				detail: Array.join(
					[
						stance,
						...Array.map(
							Option.toArray(sighting),
							entry => `seen ${whereFrom(origin, entry.at)} · ${ago(entry.updatedAt, now)} ago`
						)
					],
					' · '
				),
				hostile: stance === 'hostile',
				keys: Array.map([...Option.toArray(standing), ...Option.toArray(sighting)], entry => entry.key),
				mark: MARKS.Standing,
				name: player,
				section: 'players'
			} satisfies Row
		}
	)
	const places = Array.map(
		Array.filter(memory, MemoryEntry.isAnyOf(['Place'])),
		entry =>
			({
				detail: whereFrom(origin, entry.at),
				hostile: false,
				keys: [entry.key],
				mark: MARKS.Place,
				name: entry.name,
				section: 'places'
			}) satisfies Row
	)
	const routes = Array.map(
		Array.filter(memory, MemoryEntry.isAnyOf(['RouteAssaulted'])),
		entry =>
			({
				detail: Array.join(
					[`raided ${entry.count}×`, `${entry.losses} lost`, ...Array.filter(['avoided'], () => entry.avoid)],
					' · '
				),
				hostile: true,
				keys: [entry.key],
				mark: MARKS.RouteAssaulted,
				name: `route ${whereFrom(origin, entry.at)}`,
				section: 'routes'
			}) satisfies Row
	)
	const notes = Array.map(
		Array.filter(memory, MemoryEntry.isAnyOf(['Note'])),
		entry =>
			({
				detail: '',
				hostile: false,
				keys: [entry.key],
				mark: MARKS.Note,
				name: entry.text,
				section: 'notes'
			}) satisfies Row
	)
	return [...players, ...places, ...routes, ...notes]
}

// The overview's side panel: ore and fabrication, what the team remembers, and who is on it.
function Intel(props: {hud: Hud; now: number; origin: Point}) {
	const [result, act] = useAtom(actAtom)
	const rows = rowsOf(Array.fromIterable(props.hud.memory), props.origin, props.now)
	return (
		<Panel label="Intel" className="top-4 right-4 flex max-h-2/3 w-80 flex-col overflow-auto py-2">
			<p className="flex items-baseline justify-between px-3 pb-1.5">
				<span className="text-muted-foreground tracking-widest uppercase">base</span>
				<span className="text-primary">ore {props.hud.ore}</span>
			</p>
			<div className="flex flex-wrap gap-1 px-2 pb-2">
				{Array.map(DroneKind.literals, kind => (
					<Button
						key={kind}
						variant="ghost"
						size="xs"
						title={`Fabricate a ${kind}`}
						disabled={AsyncResult.isWaiting(result) || props.hud.ore < STATS[kind].cost}
						onClick={() => act({payload: {_tag: 'Fabricate', count: 1, kind}})}
					>
						+{CODES[kind]} <span className="text-muted-foreground">{STATS[kind].cost}</span>
					</Button>
				))}
			</div>
			{Array.isReadonlyArrayEmpty(rows) && (
				<p className="text-muted-foreground px-3 py-1">nothing yet · players met, raids and places land here</p>
			)}
			{Array.map(Section.literals, section => (
				<Group key={section} name={section} rows={Array.filter(rows, row => row.section === section)} />
			))}
			<p className="text-muted-foreground mt-1 flex items-center gap-2 px-3 pt-1.5">
				{Array.map(props.hud.team, member => (
					<span key={member.name} className={cn(member.online && 'text-foreground')}>
						{member.name}
					</span>
				))}
				<Button
					variant="ghost"
					size="xs"
					className="ml-auto"
					title="Copy an invite link: whoever opens it lands next to you, on your team"
					onClick={() => navigator.clipboard.writeText(`https://signal.mp281x.xyz/?invite=${props.hud.invite}`)}
				>
					+ invite
				</Button>
			</p>
		</Panel>
	)
}

function Group(props: {name: string; rows: Row[]}) {
	const forget = useAtomSet(actAtom)
	if (Array.isArrayEmpty(props.rows)) return null
	return (
		<section className="flex flex-col pb-1">
			<h2 className="text-muted-foreground px-3 pt-1.5 pb-0.5 tracking-widest uppercase">{props.name}</h2>
			<ul>
				{Array.map(props.rows, row => (
					<li
						key={Array.join(row.keys, ' ')}
						className="group hover:bg-foreground/5 flex items-baseline gap-2 px-3 py-1"
					>
						<span className={cn('text-muted-foreground w-3 shrink-0', row.hostile && 'text-destructive')}>
							{row.mark}
						</span>
						<span className="flex flex-1 flex-col">
							<span>{row.name}</span>
							{String.isNonEmpty(row.detail) && <span className="text-muted-foreground">{row.detail}</span>}
						</span>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Forget ${row.name}`}
							className="text-muted-foreground invisible size-4 group-hover:visible"
							onClick={() => {
								for (const key of row.keys) forget({payload: {_tag: 'Forget', key}})
							}}
						>
							×
						</Button>
					</li>
				))}
			</ul>
		</section>
	)
}

function Hints(props: {focus: Focus}) {
	return (
		<p className="text-muted-foreground absolute right-4 bottom-4 hidden items-center gap-3 lg:flex">
			{Array.map(
				Boolean.match(props.focus.overview, {
					onFalse: () => [
						['Tab', 'next'],
						['F', Boolean.match(props.focus.controlled, {onFalse: () => 'fly', onTrue: () => 'release'})],
						['Q', 'overview'],
						['/', 'ask']
					],
					onTrue: () => [
						['Tab', 'next'],
						['Q', 'back'],
						['/', 'ask']
					]
				}),
				entry => (
					<span key={entry[0]} className="flex items-center gap-1.5">
						<Key>{entry[0]}</Key>
						{entry[1]}
					</span>
				)
			)}
		</p>
	)
}

// CORE's reply streams above the box: a status line until words arrive, then the words with a caret, then what it ordered.
function Ask(props: {drone?: number; offline: boolean}) {
	const [reply, ask] = useAtom(askAtom)
	const [text, setText] = useState('')
	const [hidden, setHidden] = useState(true)
	const input = useRef<HTMLInputElement>(null)
	useEffect(() => {
		// The key, not its position: on many layouts "/" is Shift and another key.
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== '/' || event.target instanceof HTMLInputElement) return
			event.preventDefault()
			input.current?.focus()
		}
		addEventListener('keydown', onKeyDown)
		return () => removeEventListener('keydown', onKeyDown)
	}, [])
	const waiting = AsyncResult.isWaiting(reply)
	// While a new question waits for its first words, the atom still holds the last finished reply.
	const fresh = Option.filter(AsyncResult.value(reply), value => !waiting || !value.done)
	return (
		<div className="absolute bottom-4 left-1/2 flex w-full max-w-xl -translate-x-1/2 flex-col gap-px px-4">
			{!hidden && (
				<section aria-label="CORE" aria-live="polite" className="bg-background/85 flex flex-col gap-1 px-3 py-2.5">
					<p className="text-primary flex justify-between tracking-widest uppercase">
						CORE
						<span className="text-muted-foreground normal-case">esc dismiss</span>
					</p>
					{Option.match(AsyncResult.error(reply), {
						onNone: () => null,
						onSome: error => <p className="text-destructive">{error.message}</p>
					})}
					{waiting && Option.isNone(fresh) && (
						<p className="text-muted-foreground motion-safe:animate-pulse">reading the fleet…</p>
					)}
					{Option.match(fresh, {
						onNone: () => null,
						onSome: value => (
							<>
								<p className="leading-relaxed">
									{value.answer}
									{!value.done && (
										<span className="bg-primary ml-0.5 inline-block h-3 w-1.5 align-middle motion-safe:animate-pulse" />
									)}
								</p>
								{value.done && (
									<ul className="flex flex-wrap gap-x-3 gap-y-0.5">
										{Array.map(value.orders, order => (
											<li key={order} className="text-muted-foreground">
												<span className="text-primary">✓ </span>
												{order}
											</li>
										))}
										{Array.map(value.refused, order => (
											<li key={order} className="text-destructive">
												✕ {order}
											</li>
										))}
									</ul>
								)}
							</>
						)
					})}
				</section>
			)}
			<form
				className="bg-background/85 focus-within:border-primary flex items-center gap-2 border-b border-transparent px-3"
				onSubmit={event => {
					event.preventDefault()
					if (String.isEmpty(String.trim(text))) return
					ask(
						Option.match(Option.fromUndefinedOr(props.drone), {
							onNone: () => ({text}),
							onSome: drone => ({drone, text})
						})
					)
					setHidden(false)
					setText('')
				}}
			>
				<span className="text-primary">›</span>
				<Input
					ref={input}
					aria-label="Ask CORE"
					className="border-0 bg-transparent px-0 focus-visible:ring-0 dark:bg-transparent"
					placeholder={Boolean.match(props.offline, {
						onFalse: () => 'Ask CORE — e.g. send two scouts north',
						onTrue: () => 'CORE offline'
					})}
					disabled={props.offline}
					value={text}
					onChange={event => setText(event.target.value)}
					onKeyDown={event => {
						if (event.key !== 'Escape') return
						setHidden(true)
						event.currentTarget.blur()
					}}
				/>
				<Key>/</Key>
			</form>
		</div>
	)
}
