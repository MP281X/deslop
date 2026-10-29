import {RegistryContext, useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Number, Option, Order, Record, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {RotateCcw, RotateCw, ZoomIn, ZoomOut} from 'lucide-react'
import type {PointerEvent, ReactNode, WheelEvent} from 'react'
import {useContext, useEffect, useRef, useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {cn} from '@deslop/components-web/utils'

import {createCast} from './-cast.ts'
import type {Cast} from './-cast.ts'
import {createRenderer} from './-renderer.ts'
import type {Renderer} from './-renderer.ts'

import {askAtom, hoverAtom, viewAtom} from '#lib/utils.ts'
import type {View} from '#lib/utils.ts'
import {RESEARCH, bearing, nameOf} from '#services/game/lib/utils.ts'
import type {Frame, Hud, JobView, Point, UnitView} from '#services/game/schema.ts'

// Unit glyphs: each kind's characteristic part, on lucide's 24 grid and stroke.
const GLYPHS = {
	cart: (
		<>
			<path d="M2.5 6.5h12L13 14H4z" />
			<path d="M14.5 9.5h3.5l3 3.5v3.5h-6.5" />
			<circle cx="7" cy="18" r="2" />
			<circle cx="17" cy="18" r="2" />
		</>
	),
	digger: (
		<>
			<rect x="7" y="2.5" width="10" height="5" rx="1" />
			<path d="M8.5 7.5 12 21.5l3.5-14" />
			<path d="M9.5 11.8l4.9-1.6" />
			<path d="M10.5 15.9l2.8-.9" />
		</>
	),
	dozer: (
		<>
			<path d="M2.5 5h2.5c-1.3 4.6-1.3 9.4 0 14H2.5" />
			<path d="M5 12h4" />
			<rect x="9" y="13" width="13" height="6" rx="3" />
			<path d="M11.5 13V8h5l2 5" />
		</>
	),
	loader: (
		<>
			<path d="M2.5 4.5h5" />
			<path d="M16.5 4.5h5" />
			<rect x="7.5" y="3" width="9" height="5" rx="1.5" />
			<path d="M12 8v4" />
			<path d="M8.5 20c-1-3.5.5-8 3.5-8s4.5 4.5 3.5 8" />
		</>
	),
	rotor: (
		<>
			<path d="M3 5h18" />
			<path d="M12 5v4" />
			<rect x="6.5" y="9" width="11" height="7" rx="3.5" />
			<path d="M17.5 12.5H22" />
			<path d="M8 19.5h8" />
		</>
	),
	sentry: (
		<>
			<rect x="2" y="15.5" width="17" height="5" rx="2.5" />
			<path d="M5 15.5a5.5 4.5 0 0 1 11 0" />
			<path d="M14 11l8-3" />
		</>
	),
	skiff: (
		<>
			<circle cx="12" cy="12" r="9" />
			<circle cx="12" cy="12" r="1.5" />
			<path d="M12 10.5c-2-1.5-2-4.5 0-6" />
			<path d="M13.3 12.8c2.4-.3 4.6 1.6 4.6 3.7" />
			<path d="M10.7 12.8c-.4 2.4-3 3.9-4.9 3.1" />
		</>
	),
	strider: (
		<>
			<path d="M5 3h8" />
			<path d="M9 3l6.5 7.5-6 6 2.5 4.5" />
			<path d="M9.5 21h5" />
		</>
	),
	worker: (
		<>
			<rect x="4.5" y="8" width="15" height="11" rx="3" />
			<path d="M12 8V5" />
			<circle cx="12" cy="3.5" r="1" />
			<path d="M9 12.5v2" />
			<path d="M15 12.5v2" />
		</>
	)
}
const NOWHERE = Option.none<{x: number; y: number}>()
const byAmount = Order.mapInput(Order.Number, (entry: [string, number]) => -entry[1])

function percent(share: number) {
	return `${Number.round(Number.clamp(share, {maximum: 1, minimum: 0}) * 100, 0)}%`
}

function glyphOf(kind: string) {
	return Option.map(
		Array.findFirst(Record.toEntries(GLYPHS), entry => entry[0] === kind),
		entry => entry[1]
	)
}

// Hostiles have no glyph: only the colony's own kinds do.
function isUnit(kind: string) {
	return Option.isSome(glyphOf(kind))
}

function numberOf(unit: UnitView, units: Frame['units']) {
	return Array.countBy(units, other => other.kind === unit.kind && other.id <= unit.id)
}

// A pinch on a trackpad arrives as a wheel with ctrl held, in smaller deltas.
function wheelRate(pinch: boolean) {
	if (pinch) return 0.01
	return 0.0015
}

// Where a place lies from Home, in the words the task list uses.
function where(at: Point, home: Point) {
	if (Math.hypot(at.x - home.x, at.z - home.z) < 6) return 'Home'
	return bearing(home, at)
}

// Q and E turn the view a quarter, + and - zoom on the middle of the screen.
function shortcut(renderer: Renderer, event: KeyboardEvent) {
	if (event.target instanceof HTMLInputElement) return
	if (String.toLowerCase(event.key) === 'q') renderer.turn(-1)
	if (String.toLowerCase(event.key) === 'e') renderer.turn(1)
	if (event.key === '+' || event.key === '=') renderer.zoomAt(1 / 1.3, innerWidth / 2, innerHeight / 2)
	if (event.key === '-') renderer.zoomAt(1.3, innerWidth / 2, innerHeight / 2)
}

function Glyph(props: {kind: string}) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-4 flex-none"
		>
			{Option.getOrUndefined(glyphOf(props.kind))}
		</svg>
	)
}

// A unit named by its glyph and number: "cart 2" without the word.
function Tag(props: {id: number; units: Frame['units']}) {
	return Option.getOrUndefined(
		Option.map(
			Array.findFirst(props.units, unit => unit.id === props.id),
			unit => (
				<span
					title={nameOf(unit.kind, numberOf(unit, props.units))}
					className="text-foreground inline-flex items-center gap-0.5 font-medium tabular-nums"
				>
					<Glyph kind={unit.kind} />
					{numberOf(unit, props.units)}
				</span>
			)
		)
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
			<span className="text-muted-foreground w-18 text-right whitespace-nowrap tabular-nums">{props.value}</span>
		</span>
	)
}

function Bar(props: {value: number}) {
	return (
		<span className="bg-input block h-1">
			<i className="bg-foreground block h-full w-(--fill)" style={{'--fill': percent(props.value)}} />
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

// One row of the task list: what, where, how far along; the row moves the view to its place.
function Row(props: {children: ReactNode; className?: string; onClick: () => void}) {
	return (
		<Button
			variant="ghost"
			onClick={props.onClick}
			className={cn('block h-auto w-full p-3 text-left whitespace-normal not-first:border-t', props.className)}
		>
			{props.children}
		</Button>
	)
}

function Heading(props: {children: ReactNode; place: string}) {
	return (
		<span className="flex items-center justify-between gap-3">
			{props.children}
			<span className="text-muted-foreground whitespace-nowrap">{props.place}</span>
		</span>
	)
}

function Job(props: {home: Point; job: JobView; look: (at: Point) => void; units: Frame['units']}) {
	return (
		<Row onClick={() => props.look(props.job.at)}>
			<Heading place={where(props.job.at, props.home)}>
				<span className="font-medium">{props.job.title}</span>
			</Heading>
			<Meter value={props.job.detail || percent(props.job.progress)}>
				<Bar value={props.job.progress} />
			</Meter>
			<span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1">
				{Array.map(props.job.crew, id => (
					<Tag key={id} id={id} units={props.units} />
				))}
				{Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(props.job.blocked), blocked => (
						<span className="text-destructive ml-1">{blocked}</span>
					))
				)}
			</span>
		</Row>
	)
}

// The task list: alerts first, then every job with its progress and crew, then the lab.
function Tasks(props: {hud: Hud; look: (at: Point) => void; units: Frame['units']}) {
	const alerts = Array.take(props.hud.alerts, 2)
	const research = Option.all({
		left: Option.fromUndefinedOr(props.hud.research.left),
		tier: Array.get(RESEARCH, props.hud.research.tier - 1)
	})
	if (Array.isReadonlyArrayEmpty(alerts) && Array.isReadonlyArrayEmpty(props.hud.jobs) && Option.isNone(research)) {
		return undefined
	}
	return (
		<Panel label="Tasks" className="top-4 left-4 w-86">
			{Array.map(alerts, alert => (
				<Row
					key={`${alert.time}-${alert.text}`}
					onClick={() => props.look(alert.at)}
					className="bg-destructive/7 hover:bg-destructive/12"
				>
					<Heading place={where(alert.at, props.hud.home)}>
						<span className="text-destructive font-medium">{alert.text}</span>
					</Heading>
					{Option.getOrUndefined(
						Option.map(
							Option.flatMap(Option.fromUndefinedOr(alert.unit), id =>
								Array.findFirst(props.units, unit => unit.id === id)
							),
							unit => (
								<Meter value={percent(unit.health)}>
									<Pips value={unit.health} />
								</Meter>
							)
						)
					)}
				</Row>
			))}
			{Array.map(props.hud.jobs, job => (
				<Job key={job.id} job={job} home={props.hud.home} look={props.look} units={props.units} />
			))}
			{Option.getOrUndefined(
				Option.map(research, running => (
					<Row onClick={() => props.look(props.hud.lab)}>
						<Heading place="Lab">
							<span className="font-medium">Research: {running.tier.name}</span>
						</Heading>
						<Meter value={`${Math.ceil(running.left)} s`}>
							<Bar value={1 - running.left / running.tier.seconds} />
						</Meter>
					</Row>
				))
			)}
		</Panel>
	)
}

function Materials(props: {stock: Hud['stock']}) {
	return (
		<Panel
			label="Materials"
			className="text-muted-foreground top-4 right-4 flex h-8 items-center gap-4 px-3 whitespace-nowrap"
		>
			{Array.map(
				Array.sort(
					Array.filter(Record.toEntries(props.stock), entry => entry[1] > 0),
					byAmount
				),
				entry => (
					<span key={entry[0]}>
						{entry[0]}
						<b className="text-foreground ml-1 font-medium tabular-nums">
							{Number.round(entry[1], 0).toLocaleString('en-US')}
						</b>
					</span>
				)
			)}
		</Panel>
	)
}

// CORE's latest line while nothing streams: its last answer, or what it can do.
function lastLine(hud: Hud) {
	if (hud.core.planner === 'offline') return 'Offline: the server has no model key. The crews keep working.'
	return Option.getOrElse(
		Option.map(
			Array.findLast(hud.chat, turn => turn.by === 'CORE'),
			turn => turn.text
		),
		() => 'Ready. Ask for anything: mine copper, build a ramp, guard the field.'
	)
}

// CORE's line and the one input the player needs: say what you want.
function Core(props: {hud: Hud}) {
	const [reply, ask] = useAtom(askAtom)
	const [text, setText] = useState('')
	return (
		<Panel label="CORE" className="bottom-4 left-1/2 w-160 -translate-x-1/2 text-sm">
			<p className="flex gap-3 p-3">
				<span className="text-muted-foreground font-medium">CORE</span>
				<span className="flex-1">
					{AsyncResult.match(reply, {
						onFailure: failure =>
							Option.match(AsyncResult.error(failure), {
								onNone: () => 'CORE did not answer.',
								onSome: error => error.message
							}),
						onInitial: initial =>
							Option.getOrElse(
								Option.liftPredicate('…', () => initial.waiting),
								() => lastLine(props.hud)
							),
						// The answer streams in as CORE writes it; once whole, it is the conversation's last line.
						onSuccess: success =>
							Option.getOrElse(
								Option.liftPredicate(success.value.answer || '…', () => success.waiting),
								() => lastLine(props.hud)
							)
					})}
				</span>
			</p>
			<form
				className="flex h-10 items-center gap-3 border-t px-3"
				onSubmit={event => {
					event.preventDefault()
					if (String.isEmpty(String.trim(text))) return
					ask(String.trim(text))
					setText('')
				}}
			>
				<input
					value={text}
					onChange={event => setText(event.target.value)}
					placeholder="Tell CORE what you want"
					aria-label="Message CORE"
					maxLength={400}
					className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
				/>
				<kbd className="text-muted-foreground text-xs">Enter</kbd>
			</form>
		</Panel>
	)
}

// The hover card: what a unit is and what it is doing, in plain words, with its health.
function Card(props: {unit: UnitView; units: Frame['units']}) {
	const friendly = isUnit(props.unit.kind)
	const load = Option.getOrElse(
		Option.map(
			Option.filter(Option.fromUndefinedOr(props.unit.cargo), () => props.unit.load > 0),
			cargo => `, ${percent(props.unit.load)} ${cargo}`
		),
		() => ''
	)
	return (
		<div className="bg-popover text-popover-foreground absolute bottom-7 left-0 w-62 -translate-x-1/2 border p-3">
			<Heading
				place={Option.getOrElse(
					Option.liftPredicate(props.unit.kind, () => friendly),
					() => 'hostile'
				)}
			>
				<span className="flex items-center gap-1 font-medium">
					{Option.getOrUndefined(Option.liftPredicate(<Glyph kind={props.unit.kind} />, () => friendly))}
					{Option.getOrElse(
						Option.liftPredicate(nameOf(props.unit.kind, numberOf(props.unit, props.units)), () => friendly),
						() => props.unit.kind
					)}
				</span>
			</Heading>
			<p className="text-muted-foreground mt-1 first-letter:uppercase">
				{props.unit.doing}
				{load}
			</p>
			<Meter value={percent(props.unit.health)}>
				<Pips value={props.unit.health} hostile={!friendly} />
			</Meter>
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
				A colony on an endless terraced world. You say what you want; CORE sends the crews.
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

// The world view and the HUD over it: the canvas belongs to the renderer, and frames reach it through the registry, not React.
function Colony(props: {hud: Hud; seed: number; view: View}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const overlay = useRef<HTMLDivElement>(null)
	const [world, setWorld] = useState(Option.none<{cast: Cast; renderer: Renderer}>)
	const [hover, setHover] = useAtom(hoverAtom)
	const drag = useRef(NOWHERE)
	useEffect(() => {
		if (canvas.current === null) return
		const renderer = createRenderer(canvas.current, props.seed)
		const cast = createCast(renderer)
		const looked = {done: false}
		const frames = registry.subscribe(
			viewAtom,
			result => {
				if (!AsyncResult.isSuccess(result)) return
				renderer.changes(result.value.frame.changes)
				cast.frame(result.value.frame)
				Option.match(result.value.hud, {
					onNone: () => undefined,
					onSome: hud => {
						cast.places(hud)
						// The view starts on Home once; after that only the player moves it.
						if (!looked.done) renderer.look(hud.home.x, hud.home.z)
						looked.done = true
					}
				})
			},
			{immediate: true}
		)
		// Health pips and the hover card follow their units on screen every frame.
		renderer.onFrame(() => {
			for (const element of Array.fromIterable(overlay.current?.querySelectorAll<HTMLElement>('[data-follow]') ?? [])) {
				const point = Option.getOrUndefined(
					Option.flatMap(Number.parse(element.dataset['follow'] ?? ''), id => cast.screenOf(id))
				)
				element.hidden = point === undefined
				if (point !== undefined) {
					element.style.transform = `translate(${Number.round(point.x, 0)}px, ${Number.round(point.y, 0)}px)`
				}
			}
		})
		function keys(event: KeyboardEvent) {
			shortcut(renderer, event)
		}
		addEventListener('keydown', keys)
		setWorld(Option.some({cast, renderer}))
		return () => {
			removeEventListener('keydown', keys)
			frames()
			renderer.dispose()
		}
	}, [registry, props.seed])

	function down(event: PointerEvent<HTMLCanvasElement>) {
		drag.current = Option.some({x: event.clientX, y: event.clientY})
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	function move(event: PointerEvent<HTMLCanvasElement>) {
		Option.match(world, {
			onNone: () => undefined,
			onSome: active =>
				Option.match(drag.current, {
					onNone: () =>
						setHover(
							Option.map(active.cast.pick(event.clientX, event.clientY), id => ({
								id: `${id}`,
								x: event.clientX,
								y: event.clientY
							}))
						),
					onSome: from => {
						active.renderer.pan(event.clientX - from.x, event.clientY - from.y)
						drag.current = Option.some({x: event.clientX, y: event.clientY})
					}
				})
		})
	}

	function wheel(event: WheelEvent<HTMLCanvasElement>) {
		Option.match(world, {
			onNone: () => undefined,
			onSome: active =>
				active.renderer.zoomAt(Math.exp(event.deltaY * wheelRate(event.ctrlKey)), event.clientX, event.clientY)
		})
	}

	function zoom(factor: number) {
		Option.match(world, {
			onNone: () => undefined,
			onSome: active => active.renderer.zoomAt(factor, innerWidth / 2, innerHeight / 2)
		})
	}

	function turn(quarters: number) {
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.turn(quarters)})
	}

	function look(at: Point) {
		Option.match(world, {onNone: () => undefined, onSome: active => active.renderer.look(at.x, at.z)})
	}

	const units = props.view.frame.units
	return (
		<div className="absolute inset-0">
			<canvas
				ref={canvas}
				aria-label="Signal"
				className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing"
				onPointerDown={down}
				onPointerMove={move}
				onPointerUp={() => {
					drag.current = NOWHERE
				}}
				onPointerLeave={() => setHover(Option.none())}
				onWheel={wheel}
			/>
			<div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
				{Array.map(
					Array.filter(units, unit => unit.health < 0.999 && unit.act !== 'die'),
					unit => (
						<div key={unit.id} data-follow={unit.id} hidden className="absolute top-0 left-0">
							<div className="bg-popover/90 -mt-5 -ml-5 w-10 border p-0.5">
								<Pips value={unit.health} hostile={!isUnit(unit.kind)} />
							</div>
						</div>
					)
				)}
				{Option.getOrUndefined(
					Option.map(
						Option.flatMap(hover, entry => Array.findFirst(units, unit => `${unit.id}` === entry.id)),
						unit => (
							<div data-follow={unit.id} hidden className="absolute top-0 left-0">
								<Card unit={unit} units={units} />
							</div>
						)
					)
				)}
			</div>
			<Tasks hud={props.hud} units={units} look={look} />
			<Materials stock={props.hud.stock} />
			<Core hud={props.hud} />
			<div className="absolute right-4 bottom-4 flex gap-2">
				<div className="bg-popover flex border">
					<Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => zoom(1.3)}>
						<ZoomOut />
					</Button>
					<Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoom(1 / 1.3)}>
						<ZoomIn />
					</Button>
				</div>
				<div className="bg-popover flex border">
					<Button variant="ghost" size="icon" aria-label="Turn left" onClick={() => turn(-1)}>
						<RotateCcw />
					</Button>
					<Button variant="ghost" size="icon" aria-label="Turn right" onClick={() => turn(1)}>
						<RotateCw />
					</Button>
				</div>
			</div>
		</div>
	)
}

function Signal() {
	return (
		<main className="relative h-dvh w-dvw overflow-hidden font-mono text-xs select-none">
			{AsyncResult.match(useAtomValue(viewAtom), {
				onFailure: failure =>
					Option.match(
						Option.filter(AsyncResult.error(failure), error => error._tag === 'AuthError'),
						{onNone: () => <Status>Reconnecting</Status>, onSome: () => <SignIn />}
					),
				onInitial: () => <Status>Connecting</Status>,
				onSuccess: success =>
					Option.match(Option.all({hud: success.value.hud, world: success.value.world}), {
						onNone: () => <Status>Connecting</Status>,
						onSome: ready => <Colony hud={ready.hud} seed={ready.world.seed} view={success.value} />
					})
			})}
		</main>
	)
}

export const Route = createFileRoute('/(home)/')({component: Signal})
