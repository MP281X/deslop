import {RegistryContext, useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Number, Option, Order, Record, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import type {PointerEvent, ReactNode, WheelEvent} from 'react'
import {useContext, useEffect, useRef, useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {cn} from '@deslop/components-web/utils'

import {createCast} from './-cast.ts'
import type {Cast} from './-cast.ts'
import {createRenderer} from './-renderer.ts'
import type {Renderer} from './-renderer.ts'

import {askAtom, followAtom, hoverAtom, viewAtom} from '#lib/utils.ts'
import type {Follow, View} from '#lib/utils.ts'
import {CREATURES, RESEARCH, nameOf} from '#services/game/lib/utils.ts'
import type {Frame, Hud, Point, Reply, UnitView} from '#services/game/schema.ts'
import {UnitKind} from '#services/game/schema.ts'

// Edge chips sit this far in from the screen's edge.
const CHIP_MARGIN = 28
const ZOOM_STEP = 1.25
// The keys and what they do, as the shortcuts overlay lists them.
const SHORTCUTS = [
	{does: 'next / previous unit', keys: 'Tab / Shift Tab'},
	{does: 'overview round the unit', keys: 'Q'},
	{does: 'back to the unit', keys: 'Esc'},
	{does: 'turn left / right', keys: 'Z / X'},
	{does: 'zoom in / out', keys: '+ / − or wheel'},
	{does: 'follow a unit', keys: 'click it or its chip'},
	{does: 'talk to CORE', keys: '/ or Enter'},
	{does: 'toggle this overlay', keys: '?'}
]

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
const byAmount = Order.mapInput(Order.Number, (entry: [string, number]) => -entry[1])
const byRoster = Order.combine(
	Order.mapInput(Order.Number, (unit: UnitView) =>
		Option.getOrElse(
			Array.findFirstIndex(UnitKind.literals, kind => kind === unit.kind),
			() => 99
		)
	),
	Order.mapInput(Order.Number, (unit: UnitView) => unit.id)
)

type Command = 'help' | 'in' | 'leave' | 'left' | 'next' | 'out' | 'overview' | 'previous' | 'right' | 'talk'

function percent(share: number) {
	return `${Number.round(Number.clamp(share, {maximum: 1, minimum: 0}) * 100, 0)}%`
}

function glyphOf(kind: string) {
	return Option.map(
		Array.findFirst(Record.toEntries(GLYPHS), entry => entry[0] === kind),
		entry => entry[1]
	)
}

// Only the colony's own kinds have a glyph.
function isUnit(kind: string) {
	return Option.isSome(glyphOf(kind))
}

function creatureOf(kind: string) {
	return Option.map(
		Array.findFirst(Record.toEntries(CREATURES), entry => entry[0] === kind),
		entry => entry[1]
	)
}

function numberOf(unit: UnitView, units: Frame['units']) {
	return Array.countBy(units, other => other.kind === unit.kind && other.id <= unit.id)
}

function ownUnits(units: Frame['units']) {
	return Array.sort(
		Array.filter(units, unit => isUnit(unit.kind)),
		byRoster
	)
}

// A pinch on a trackpad arrives as a wheel with ctrl held, in smaller deltas.
function wheelRate(pinch: boolean) {
	if (pinch) return 0.01
	return 0.0015
}

function letterCommand(code: string, repeat: boolean) {
	if (code === 'KeyQ' && !repeat) return Option.some<Command>('overview')
	if (code === 'KeyZ') return Option.some<Command>('left')
	if (code === 'KeyX') return Option.some<Command>('right')
	return Option.none<Command>()
}

function symbolCommand(key: string) {
	if (key === '+' || key === '=') return Option.some<Command>('in')
	if (key === '-' || key === '_') return Option.some<Command>('out')
	if (key === '/' || key === 'Enter') return Option.some<Command>('talk')
	if (key === '?') return Option.some<Command>('help')
	if (key === 'Escape') return Option.some<Command>('leave')
	return Option.none<Command>()
}

// What a key does: letters by their place on the keyboard, symbols by what they type, so both read the same on any layout. Keys typed into a field are its own.
function commandOf(event: KeyboardEvent) {
	if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) {
		return Option.none<Command>()
	}
	if (event.key === 'Tab' && event.shiftKey) return Option.some<Command>('previous')
	if (event.key === 'Tab') return Option.some<Command>('next')
	return Option.orElse(letterCommand(event.code, event.repeat), () => symbolCommand(event.key))
}

// Where an off-screen point's chip sits: on the screen's edge, on the line from the middle toward it; none while the point is on screen.
function chipAt(point: {x: number; y: number}, size: {height: number; width: number}) {
	const inside =
		point.x > CHIP_MARGIN &&
		point.x < size.width - CHIP_MARGIN &&
		point.y > CHIP_MARGIN &&
		point.y < size.height - CHIP_MARGIN
	if (inside) return Option.none<{x: number; y: number}>()
	const dx = point.x - size.width / 2
	const dy = point.y - size.height / 2
	const scale = Number.min(
		(size.width / 2 - CHIP_MARGIN) / Number.max(Math.abs(dx), 1e-6),
		(size.height / 2 - CHIP_MARGIN) / Number.max(Math.abs(dy), 1e-6)
	)
	return Option.some({x: size.width / 2 + dx * scale, y: size.height / 2 + dy * scale})
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
			<span className="text-muted-foreground min-w-18 text-right whitespace-nowrap tabular-nums">{props.value}</span>
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

function Heading(props: {children: ReactNode; place: string}) {
	return (
		<span className="flex items-center justify-between gap-3">
			{props.children}
			<span className="text-muted-foreground whitespace-nowrap">{props.place}</span>
		</span>
	)
}

function Row(props: {children: ReactNode; className?: string; onClick: () => void}) {
	return (
		<Button
			variant="ghost"
			onClick={props.onClick}
			className={cn('block h-auto w-full border-t p-3 text-left whitespace-normal', props.className)}
		>
			{props.children}
		</Button>
	)
}

function doingOf(unit: UnitView) {
	return `${unit.doing}${Option.getOrElse(
		Option.map(
			Option.filter(Option.fromUndefinedOr(unit.cargo), () => unit.load > 0),
			cargo => `, ${percent(unit.load)} ${cargo}`
		),
		() => ''
	)}`
}

// A job's progress, and why it waits when it does.
function JobLine(props: {job: Hud['jobs'][number]}) {
	return (
		<div className="border-t p-3">
			<span className="font-medium">{props.job.title}</span>
			<Meter value={props.job.detail || percent(props.job.progress)}>
				<Bar value={props.job.progress} />
			</Meter>
			{Option.getOrUndefined(
				Option.map(Option.fromUndefinedOr(props.job.blocked), blocked => (
					<p className="text-destructive mt-1">{blocked}</p>
				))
			)}
		</div>
	)
}

// The unit the camera follows, or the overview round it, with its job; under it the latest alerts, each following its unit, the jobs that wait on something, and the lab while it researches.
function Focus(props: {
	follow: Follow
	hud: Hud
	onAlert: (alert: Hud['alerts'][number]) => void
	units: Frame['units']
}) {
	const unit = Array.findFirst(props.units, entry => Option.contains(props.follow.id, entry.id))
	const own = ownUnits(props.units)
	function crewed(job: Hud['jobs'][number]) {
		return Option.exists(props.follow.id, id => Array.contains(job.crew, id))
	}
	const research = Option.all({
		left: Option.fromUndefinedOr(props.hud.research.left),
		tier: Array.get(RESEARCH, props.hud.research.tier - 1)
	})
	return (
		<Panel label="Following" className="top-4 left-4 w-80">
			{Option.getOrUndefined(
				Option.map(unit, followed => (
					<div className="p-3">
						<Heading
							place={Option.match(props.follow.overview, {
								onNone: () =>
									`${
										Option.getOrElse(
											Array.findFirstIndex(own, entry => entry.id === followed.id),
											() => 0
										) + 1
									} of ${own.length}`,
								onSome: () => 'overview'
							})}
						>
							<span className="flex items-center gap-1 font-medium">
								<Glyph kind={followed.kind} />
								{nameOf(followed.kind, numberOf(followed, props.units))}
							</span>
						</Heading>
						<p className="text-muted-foreground mt-1 first-letter:uppercase">{doingOf(followed)}</p>
						<Meter value={percent(followed.health)}>
							<Pips value={followed.health} />
						</Meter>
					</div>
				))
			)}
			{Array.map(Array.filter(props.hud.jobs, crewed), job => (
				<JobLine key={job.id} job={job} />
			))}
			{Array.map(Array.take(props.hud.alerts, 2), alert => (
				<Row
					key={`${alert.time}-${alert.text}`}
					onClick={() => props.onAlert(alert)}
					className="bg-destructive/7 hover:bg-destructive/12"
				>
					<span className="text-destructive font-medium">{alert.text}</span>
				</Row>
			))}
			{Array.map(
				Array.take(
					Array.filter(props.hud.jobs, job => job.blocked !== undefined && !crewed(job)),
					2
				),
				job => (
					<JobLine key={job.id} job={job} />
				)
			)}
			{Option.getOrUndefined(
				Option.map(research, running => (
					<div className="border-t p-3">
						<span className="font-medium">Research: {running.tier.name}</span>
						<Meter value={`${Math.ceil(running.left)} s`}>
							<Bar value={1 - running.left / running.tier.seconds} />
						</Meter>
					</div>
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

function lastTurn(hud: Hud) {
	return Array.findLast(hud.chat, turn => turn.by === 'CORE')
}

// CORE's latest line while nothing streams: its last answer, or what it can do.
function lastLine(hud: Hud) {
	if (hud.core.planner === 'offline') return 'Offline: the server has no model key. The crews keep working.'
	return Option.getOrElse(
		Option.map(lastTurn(hud), turn => turn.text),
		() => 'Ready. Ask for anything: mine copper, build a ramp, guard the field.'
	)
}

// While CORE reads the colony and plans, before its first words.
function Thinking() {
	return <span className="text-muted-foreground motion-safe:animate-pulse">Reading the colony and planning…</span>
}

// The bar along CORE's panel while it works.
function Sweep() {
	return (
		<span className="absolute inset-x-0 top-0 block h-0.5 overflow-hidden">
			<i className="bg-foreground animate-sweep block h-full w-2/5 motion-reduce:animate-pulse" />
		</span>
	)
}

// The answer as CORE writes it, with a caret until it is whole.
function Writing(props: {streaming: boolean; text: string}) {
	return (
		<>
			{props.text}
			{Option.getOrUndefined(
				Option.liftPredicate(
					<i className="bg-foreground ml-0.5 inline-block h-3 w-1.5 align-middle motion-safe:animate-pulse" />,
					() => props.streaming
				)
			)}
		</>
	)
}

// CORE's line and the one input the player needs: say what you want. Every send shows what was asked and that CORE is on it, until its answer streams in.
function Core(props: {hud: Hud}) {
	const [reply, ask] = useAtom(askAtom)
	const [text, setText] = useState('')
	// What was asked, when CORE last spoke before it (the HUD has the answer once CORE has spoken since) and the reply the last send left behind.
	const [asked, setAsked] = useState<{before: number; held: Option.Option<Reply>; text: string}>({
		before: 0,
		held: Option.none(),
		text: ''
	})
	// The last send's reply, whole or cut off, stays the value while the next one waits: only a reply since this send is new, partial or whole, until the HUD catches up with it.
	const value = Option.filter(AsyncResult.value(reply), entry => !Option.exists(asked.held, held => held === entry))
	const streaming = reply.waiting && Option.exists(value, entry => !entry.done)
	const unheard =
		!reply.waiting &&
		Option.exists(value, entry => entry.done) &&
		Option.getOrElse(
			Option.map(lastTurn(props.hud), turn => turn.at),
			() => 0
		) <= asked.before
	const writing = Option.filter(
		Option.map(value, entry => entry.answer),
		answer => String.isNonEmpty(answer) && (streaming || unheard)
	)
	const failed = Option.map(Option.liftPredicate(reply, AsyncResult.isFailure), failure =>
		Option.match(AsyncResult.error(failure), {onNone: () => 'CORE did not answer.', onSome: error => error.message})
	)
	return (
		<Panel label="CORE" className="bottom-4 left-1/2 w-160 -translate-x-1/2 text-sm">
			{Option.getOrUndefined(Option.liftPredicate(<Sweep />, () => reply.waiting))}
			{Option.getOrUndefined(
				Option.liftPredicate(
					<p className="text-muted-foreground flex gap-3 border-b p-3">
						<span className="font-medium">You</span>
						<span className="flex-1 truncate">{asked.text}</span>
					</p>,
					() => reply.waiting
				)
			)}
			<p className="flex gap-3 p-3">
				<span className="text-muted-foreground font-medium">CORE</span>
				<span className="flex-1">
					{Option.match(writing, {
						onNone: () =>
							Option.getOrElse(
								Option.liftPredicate(<Thinking />, () => reply.waiting),
								() => Option.getOrElse(failed, () => lastLine(props.hud))
							),
						onSome: answer => <Writing text={answer} streaming={streaming} />
					})}
				</span>
			</p>
			<form
				className="flex h-10 items-center gap-3 border-t px-3"
				onSubmit={event => {
					event.preventDefault()
					if (String.isEmpty(String.trim(text)) || reply.waiting) return
					setAsked({
						before: Option.getOrElse(
							Option.map(lastTurn(props.hud), turn => turn.at),
							() => 0
						),
						held: AsyncResult.value(reply),
						text: String.trim(text)
					})
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
				{Option.getOrElse(
					Option.liftPredicate(<Spinner variant="subtle" className="size-3" />, () => reply.waiting),
					() => (
						<kbd className="text-muted-foreground text-xs">Enter</kbd>
					)
				)}
			</form>
		</Panel>
	)
}

// The hover card: what a unit or creature is and what it is doing, in plain words, with its health.
function Card(props: {unit: UnitView; units: Frame['units']}) {
	const friendly = isUnit(props.unit.kind)
	const creature = creatureOf(props.unit.kind)
	const name = Option.getOrElse(
		Option.orElse(
			Option.liftPredicate(nameOf(props.unit.kind, numberOf(props.unit, props.units)), () => friendly),
			() => Option.map(creature, entry => entry.name)
		),
		() => props.unit.kind
	)
	return (
		<div className="bg-popover text-popover-foreground absolute bottom-7 left-0 w-62 -translate-x-1/2 border p-3">
			<Heading
				place={Option.getOrElse(
					Option.orElse(
						Option.liftPredicate(props.unit.kind, () => friendly),
						() => Option.as(creature, 'wildlife')
					),
					() => 'hostile'
				)}
			>
				<span className="flex items-center gap-1 font-medium first-letter:uppercase">
					{Option.getOrUndefined(Option.liftPredicate(<Glyph kind={props.unit.kind} />, () => friendly))}
					{name}
				</span>
			</Heading>
			<p className="text-muted-foreground mt-1 first-letter:uppercase">{doingOf(props.unit)}</p>
			{Option.getOrUndefined(
				Option.map(
					Option.liftPredicate(props.unit, () => Option.isNone(creature)),
					unit => (
						<Meter value={percent(unit.health)}>
							<Pips value={unit.health} hostile={!friendly} />
						</Meter>
					)
				)
			)}
		</div>
	)
}

function Shortcuts(props: {open: boolean; onOpenChange: (open: boolean) => void}) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="bg-popover p-6 font-mono sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-foreground font-mono text-sm tracking-widest uppercase">
						Keyboard shortcuts
					</DialogTitle>
				</DialogHeader>
				<dl className="text-muted-foreground grid grid-cols-2 gap-x-8 gap-y-3 text-xs">
					{Array.map(SHORTCUTS, entry => (
						<div key={entry.keys} className="contents">
							<dt className="text-foreground">{entry.keys}</dt>
							<dd>{entry.does}</dd>
						</div>
					))}
				</dl>
			</DialogContent>
		</Dialog>
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

// The world view and the HUD over it: the canvas belongs to the renderer, and frames reach it through the registry, not React. The camera follows one of the colony's units; Q frames the units round it.
function Colony(props: {hud: Hud; seed: number; view: View}) {
	const registry = useContext(RegistryContext)
	const canvas = useRef<HTMLCanvasElement>(null)
	const overlay = useRef<HTMLDivElement>(null)
	const [world, setWorld] = useState(Option.none<{cast: Cast; renderer: Renderer}>)
	const [hover, setHover] = useAtom(hoverAtom)
	const [follow, setFollow] = useAtom(followAtom)
	const [help, setHelp] = useState(false)
	// What the key handler reads, kept current outside render.
	const latest = useRef({help, units: props.view.frame.units})
	useEffect(() => {
		latest.current = {help, units: props.view.frame.units}
	}, [help, props.view.frame.units])

	useEffect(() => {
		if (canvas.current === null) return
		const renderer = createRenderer(canvas.current, props.seed)
		const cast = createCast(renderer)
		const home = {at: Option.none<Point>(), stamped: false}
		const frames = registry.subscribe(
			viewAtom,
			result => {
				if (!AsyncResult.isSuccess(result)) return
				renderer.changes(result.value.frame.changes)
				// A new renderer starts from everything explored so far, then takes each frame's news.
				if (home.stamped) renderer.explored(result.value.frame.explored)
				else renderer.explored(Record.values(result.value.explored))
				home.stamped = true
				cast.frame(result.value.frame)
				home.at = Option.map(result.value.hud, hud => hud.home)
				Option.match(result.value.hud, {onNone: () => undefined, onSome: hud => cast.places(hud)})
				// The camera always has a unit to follow while the colony has one: the first, or the next once the followed one is gone.
				const own = ownUnits(result.value.frame.units)
				const current = registry.get(followAtom)
				if (!Array.some(own, unit => Option.contains(current.id, unit.id))) {
					registry.set(followAtom, {id: Option.map(Array.head(own), unit => unit.id), overview: Option.none()})
				}
			},
			{immediate: true}
		)
		// Each frame, before the camera moves: it aims at the followed unit as drawn, at the overview's frame, or at Home.
		renderer.onFrame(() => {
			const current = registry.get(followAtom)
			renderer.aim(
				Option.match(current.overview, {
					onNone: () =>
						Option.match(
							Option.flatMap(current.id, id => Option.map(cast.positionOf(id), at => ({at, id}))),
							{
								onNone: () => {
									const at = Option.getOrElse(home.at, () => ({x: 0, z: 0}))
									return {key: 'home', x: at.x, y: renderer.ground(at.x, at.z), z: at.z, zoom: Option.none()}
								},
								onSome: followed => ({key: `unit:${followed.id}`, ...followed.at, zoom: Option.none()})
							}
						),
					onSome: frame => ({
						key: `overview:${frame.x}:${frame.z}`,
						x: frame.x,
						y: renderer.ground(frame.x, frame.z),
						z: frame.z,
						zoom: Option.some(frame.zoom)
					})
				})
			)
		})
		// Once the camera has moved: health pips and the hover card follow their units, and units off screen sit as chips on its edge.
		renderer.onDrawn(() => {
			for (const element of Array.fromIterable(overlay.current?.querySelectorAll<HTMLElement>('[data-follow]') ?? [])) {
				const point = Option.getOrUndefined(
					Option.flatMap(Number.parse(element.dataset['follow'] ?? ''), id => cast.screenOf(id))
				)
				element.hidden = point === undefined
				if (point !== undefined) {
					element.style.transform = `translate(${Number.round(point.x, 0)}px, ${Number.round(point.y, 0)}px)`
				}
			}
			for (const element of Array.fromIterable(overlay.current?.querySelectorAll<HTMLElement>('[data-chip]') ?? [])) {
				const point = Option.getOrUndefined(
					Option.flatMap(
						Option.flatMap(Number.parse(element.dataset['chip'] ?? ''), id => cast.screenOf(id)),
						at => chipAt(at, renderer.size())
					)
				)
				element.hidden = point === undefined
				if (point !== undefined) {
					element.style.transform = `translate(${Number.round(point.x, 0)}px, ${Number.round(point.y, 0)}px) translate(-50%, -50%)`
				}
			}
		})
		// Q frames the colony's units near the one followed, once: the frame holds still while they move, and Q or Esc goes back to the unit.
		function overview() {
			const current = registry.get(followAtom)
			if (Option.isSome(current.overview)) {
				registry.set(followAtom, {...current, overview: Option.none()})
				return
			}
			const own = ownUnits(latest.current.units)
			const anchor = Option.getOrElse(
				Option.orElse(
					Array.findFirst(own, unit => Option.contains(current.id, unit.id)),
					() => Array.head(own)
				),
				() => Option.getOrElse(home.at, () => ({x: 0, z: 0}))
			)
			const near = Array.filter(
				[...own, ...Option.toArray(home.at)],
				// Only units within 40 tiles of the anchor, so a far scout does not pull the frame off the rest.
				at => Math.hypot(at.x - anchor.x, at.z - anchor.z) <= 40
			)
			registry.set(followAtom, {...current, overview: Option.some(renderer.fit([anchor, ...near]))})
		}
		function cycle(step: number) {
			const own = ownUnits(latest.current.units)
			const current = registry.get(followAtom)
			const index = Option.getOrElse(
				Array.findFirstIndex(own, unit => Option.contains(current.id, unit.id)),
				() => -step
			)
			registry.set(followAtom, {
				id: Option.map(Array.get(own, (((index + step) % own.length) + own.length) % own.length), unit => unit.id),
				overview: Option.none()
			})
		}
		const commands = {
			help: () => setHelp(open => !open),
			in: () => renderer.zoomBy(1 / ZOOM_STEP),
			leave: () => registry.set(followAtom, {...registry.get(followAtom), overview: Option.none()}),
			left: () => renderer.turn(-1),
			next: () => cycle(1),
			out: () => renderer.zoomBy(ZOOM_STEP),
			overview,
			previous: () => cycle(-1),
			right: () => renderer.turn(1),
			talk: () => document.querySelector<HTMLInputElement>('input[aria-label="Message CORE"]')?.focus()
		} satisfies Record<Command, () => void>
		function keys(event: KeyboardEvent) {
			if (event.target instanceof HTMLInputElement && event.key === 'Escape') event.target.blur()
			Option.match(
				Option.filter(commandOf(event), command => !latest.current.help || command === 'help'),
				{
					onNone: () => undefined,
					onSome: command => {
						event.preventDefault()
						commands[command]()
					}
				}
			)
		}
		addEventListener('keydown', keys)
		setWorld(Option.some({cast, renderer}))
		return () => {
			removeEventListener('keydown', keys)
			frames()
			renderer.dispose()
		}
	}, [registry, props.seed])

	function followUnit(id: number) {
		setFollow({id: Option.some(id), overview: Option.none()})
	}

	// A click on one of the colony's units follows it.
	function down(event: PointerEvent<HTMLCanvasElement>) {
		Option.match(
			Option.filter(
				Option.flatMap(world, active => active.cast.pick(event.clientX, event.clientY)),
				id => Array.some(props.view.frame.units, unit => unit.id === id && isUnit(unit.kind))
			),
			{onNone: () => undefined, onSome: followUnit}
		)
	}

	function move(event: PointerEvent<HTMLCanvasElement>) {
		Option.match(world, {
			onNone: () => undefined,
			onSome: active =>
				setHover(
					Option.map(active.cast.pick(event.clientX, event.clientY), id => ({
						id: `${id}`,
						x: event.clientX,
						y: event.clientY
					}))
				)
		})
	}

	function wheel(event: WheelEvent<HTMLCanvasElement>) {
		Option.match(world, {
			onNone: () => undefined,
			onSome: active => active.renderer.zoomBy(Math.exp(event.deltaY * wheelRate(event.ctrlKey)))
		})
	}

	// An alert follows its unit, or the colony's unit nearest where it happened.
	function alerted(alert: Hud['alerts'][number]) {
		Option.match(
			Option.orElse(
				Option.filter(Option.fromUndefinedOr(alert.unit), id =>
					Array.some(props.view.frame.units, unit => unit.id === id)
				),
				() =>
					Option.map(
						Array.head(
							Array.sort(
								ownUnits(props.view.frame.units),
								Order.mapInput(Order.Number, (unit: UnitView) => Math.hypot(unit.x - alert.at.x, unit.z - alert.at.z))
							)
						),
						unit => unit.id
					)
			),
			{onNone: () => undefined, onSome: followUnit}
		)
	}

	const units = props.view.frame.units
	return (
		<div className="absolute inset-0">
			<canvas
				ref={canvas}
				aria-label="Signal"
				className="absolute inset-0 size-full touch-none"
				onPointerDown={down}
				onPointerMove={move}
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
				{Array.map(
					Array.filter(ownUnits(units), unit => !Option.contains(follow.id, unit.id)),
					unit => (
						<Button
							key={unit.id}
							variant="outline"
							size="xs"
							data-chip={unit.id}
							hidden
							title={nameOf(unit.kind, numberOf(unit, units))}
							onClick={() => followUnit(unit.id)}
							className="bg-popover pointer-events-auto absolute top-0 left-0 gap-0.5 px-1 tabular-nums"
						>
							<Glyph kind={unit.kind} />
							{numberOf(unit, units)}
						</Button>
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
			<Focus follow={follow} hud={props.hud} units={units} onAlert={alerted} />
			<Materials stock={props.hud.stock} />
			<Core hud={props.hud} />
			<Button
				variant="outline"
				size="icon"
				aria-expanded={help}
				aria-haspopup="dialog"
				aria-label="Keyboard shortcuts"
				onClick={() => setHelp(open => !open)}
				className="bg-popover absolute right-4 bottom-4"
			>
				?
			</Button>
			<Shortcuts open={help} onOpenChange={setHelp} />
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
