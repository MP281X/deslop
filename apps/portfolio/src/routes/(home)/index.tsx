/* oxlint-disable shadcn/no-arbitrary-values -- The page's 0.15-0.35em letter-spacing sits beyond tracking-widest, and the auto/1fr shortcut columns have no scale step. */
import {useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Effect,
	Function,
	HashMap,
	Number,
	Option,
	Predicate,
	Random,
	Schedule,
	Stream,
	String,
	Tuple,
	pipe
} from 'effect'

import {useHotkeys} from '@tanstack/react-hotkeys'
import {createFileRoute} from '@tanstack/react-router'
import {Atom} from 'effect/reactivity'
import {ArrowUpRight, MousePointer2} from 'lucide-react'
import {Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Kbd, KbdGroup} from '@deslop/components-web/ui/kbd'
import {cn} from '@deslop/components-web/utils'

import {hasMeaningfulMove} from '#lib/portfolio.ts'
import {contacts, education, experience, languages, profile, projects, skills, summary} from '#lib/profile.ts'
import {RpcClient} from '#lib/utils.ts'
import {PortfolioColor} from '#services/presence/schema.ts'
import type {PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6'] as const
// A cursor not yet on screen: its empty viewport makes the first sync place it at its target instead of gliding there.
const UNPLACED_MOTION = {lastFrameAt: 0, targetX: 0, targetY: 0, viewportHeight: 0, viewportWidth: 0, x: 0, y: 0}

type Scene = {trails: PortfolioVisitors; visitors: PortfolioVisitors}

function randomIndex(length: number) {
	return Math.floor(Random.Random.defaultValue().nextDoubleUnsafe() * length)
}

function randomSeed() {
	const alphabet = '0123456789abcdef'
	return pipe(
		Array.makeBy(6, () => alphabet[randomIndex(String.length(alphabet))] ?? '0'),
		Array.join('')
	)
}

function pickNextCursorColor(currentColor: PortfolioColor) {
	const nextPalette = Array.filter(PortfolioColor.literals, color => color !== currentColor)
	return nextPalette[randomIndex(Array.length(nextPalette))] ?? PortfolioColor.literals[0]
}

function getIdentity() {
	const existingId = sessionStorage.getItem('portfolio.id')
	const existingName = sessionStorage.getItem('portfolio.name')
	const color =
		PortfolioColor.literals[randomIndex(Array.length(PortfolioColor.literals))] ?? PortfolioColor.literals[0]

	if (Predicate.isNotNullish(existingId) && Predicate.isNotNullish(existingName)) {
		return {color, id: existingId, name: existingName}
	}

	const seed = randomSeed()

	const next = {color, id: `v-${seed}`, name: `Guest-${pipe(seed, String.slice(0, 3))}`}

	sessionStorage.setItem('portfolio.id', next.id)
	sessionStorage.setItem('portfolio.name', next.name)

	return next
}

const identity = getIdentity()

const portfolioAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('portfolio.join', identity)),
			Stream.unwrap,
			// A dropped socket rejoins with the trails kept, instead of turning the page into an error.
			Stream.retry(Schedule.spaced('2 seconds')),
			Stream.mapAccum<Scene, PortfolioVisitors, Scene>(
				() => ({trails: [], visitors: []}),
				(scene, visitors) => {
					// The latest 180 positions in the order visitors reached them; a recolour starts a new stretch where the cursor is.
					const next = {
						trails: Array.takeRight(
							Array.appendAll(
								scene.trails,
								Array.filter(
									visitors,
									visitor =>
										!Array.some(
											scene.visitors,
											before =>
												before.id === visitor.id &&
												before.color === visitor.color &&
												before.x === visitor.x &&
												before.y === visitor.y
										)
								)
							),
							180
						),
						visitors
					}
					return Tuple.make(next, [next])
				}
			)
		)
	)
)

function setCursorTransform(node: HTMLDivElement, x: number, y: number) {
	node.style.setProperty('--cursor-transform', `translate3d(${x}px, ${y}px, 0)`)
}

function createCursorMotion(target: {x: number; y: number}, viewport: {width: number; height: number}) {
	return {
		lastFrameAt: 0,
		targetX: target.x,
		targetY: target.y,
		viewportHeight: viewport.height,
		viewportWidth: viewport.width,
		x: target.x,
		y: target.y
	}
}

function approach(input: {catchUp: number; maximum: number; position: number; target: number}) {
	if (Math.abs(input.target - input.position) < 0.3) return input.target
	return Number.clamp({maximum: input.maximum, minimum: 0})(
		input.position + (input.target - input.position) * input.catchUp
	)
}

function stepCursorMotion(motion: ReturnType<typeof createCursorMotion>, now: number) {
	const frameDelta = Boolean.match(motion.lastFrameAt > 0, {
		onFalse: () => 16,
		onTrue: () => Number.clamp({maximum: 64, minimum: 8})(now - motion.lastFrameAt)
	})
	const deltaX = motion.targetX - motion.x
	const deltaY = motion.targetY - motion.y
	const catchUp = Number.min(1, (1 - Math.exp(-frameDelta / 130)) * (1 + Math.hypot(deltaX, deltaY) / 220))

	return {
		...motion,
		lastFrameAt: now,
		x: approach({catchUp, maximum: motion.viewportWidth, position: motion.x, target: motion.targetX}),
		y: approach({catchUp, maximum: motion.viewportHeight, position: motion.y, target: motion.targetY})
	}
}

function syncCursorMotion(
	motion: ReturnType<typeof createCursorMotion>,
	cursor: PortfolioVisitor,
	viewport: {width: number; height: number}
) {
	const target = {x: cursor.x * viewport.width, y: cursor.y * viewport.height}

	if (motion.viewportWidth !== viewport.width || motion.viewportHeight !== viewport.height) {
		return createCursorMotion(target, viewport)
	}

	if (motion.targetX === target.x && motion.targetY === target.y) return motion

	return {...motion, targetX: target.x, targetY: target.y}
}

// React Compiler skips a component whose function schedules itself, so the frame loop lives outside it.
function eachFrame(step: () => boolean, onFrame: (frame: number) => void) {
	onFrame(
		requestAnimationFrame(() => {
			if (step()) eachFrame(step, onFrame)
			else onFrame(0)
		})
	)
}

function subscribeToResize(onStoreChange: () => void) {
	addEventListener('resize', onStoreChange)
	return () => {
		removeEventListener('resize', onStoreChange)
	}
}

// The page's content over the trail grid: one opaque column, rows split by hairlines.
function Panel(input: {className?: string; children: React.ReactNode}) {
	return <div className={cn('bg-background', input.className)}>{input.children}</div>
}

function TrailCanvas(input: {trails: PortfolioVisitors; viewport: {width: number; height: number}}) {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		if (canvasRef.current === null || input.viewport.width <= 0 || input.viewport.height <= 0) return

		const canvasWidth = Number.max(1, Number.round(input.viewport.width * window.devicePixelRatio, 0))
		const canvasHeight = Number.max(1, Number.round(input.viewport.height * window.devicePixelRatio, 0))

		if (canvasRef.current.width !== canvasWidth || canvasRef.current.height !== canvasHeight) {
			canvasRef.current.width = canvasWidth
			canvasRef.current.height = canvasHeight
			canvasRef.current.style.width = `${input.viewport.width}px`
			canvasRef.current.style.height = `${input.viewport.height}px`
		}

		const context = canvasRef.current.getContext('2d')
		if (context === null) return

		context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0)
		context.clearRect(0, 0, input.viewport.width, input.viewport.height)
		context.globalAlpha = 0.22

		Array.reduce(
			input.trails,
			HashMap.empty<string, {trail: PortfolioVisitor; col: number; row: number}>(),
			(previousByVisitor, trail) => {
				const current = {
					col: Math.floor((trail.x * input.viewport.width) / 26),
					row: Math.floor((trail.y * input.viewport.height) / 26),
					trail
				}
				const previous = pipe(previousByVisitor, HashMap.get(trail.id), Option.getOrUndefined)

				if (Predicate.isUndefined(previous)) {
					context.fillStyle = current.trail.color
					context.fillRect(current.col * 26 + 1, current.row * 26 + 1, 24, 24)
					return HashMap.set(previousByVisitor, trail.id, current)
				}

				const stepCount = Number.max(Math.abs(current.col - previous.col), Math.abs(current.row - previous.row))

				for (const step of Array.makeBy(stepCount + 1, Function.identity)) {
					const progress = Boolean.match(stepCount === 0, {onFalse: () => step / stepCount, onTrue: () => 1})
					const col = Number.round(previous.col + (current.col - previous.col) * progress, 0)
					const row = Number.round(previous.row + (current.row - previous.row) * progress, 0)

					context.fillStyle = Boolean.match(progress < 1, {
						onFalse: () => current.trail.color,
						onTrue: () => previous.trail.color
					})
					context.fillRect(col * 26 + 1, row * 26 + 1, 24, 24)
				}

				return HashMap.set(previousByVisitor, trail.id, current)
			}
		)

		context.globalAlpha = 1
	}, [input.trails, input.viewport])

	return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-1" />
}

function CursorLabel(input: {label: string}) {
	return (
		<div className="flex items-center gap-1">
			<MousePointer2 className="size-4 text-(--cursor-color)" />
			<span className="bg-background text-foreground rounded-sm border border-(--cursor-color) px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">
				{input.label}
			</span>
		</div>
	)
}

// Another visitor's cursor glides behind the page towards each position the server reports.
function VisitorCursor(input: {cursor: PortfolioVisitor; viewport: {width: number; height: number}}) {
	const nodeRef = useRef<HTMLDivElement>(null)
	const motionRef = useRef(UNPLACED_MOTION)
	const animationFrameRef = useRef(0)

	// Before paint, so the cursor's first frame is already where the server put it.
	useLayoutEffect(() => {
		motionRef.current = syncCursorMotion(motionRef.current, input.cursor, input.viewport)
		if (nodeRef.current !== null) setCursorTransform(nodeRef.current, motionRef.current.x, motionRef.current.y)

		function tick(now: number) {
			if (nodeRef.current === null) return

			motionRef.current = stepCursorMotion(motionRef.current, now)
			setCursorTransform(nodeRef.current, motionRef.current.x, motionRef.current.y)
			if (motionRef.current.x !== motionRef.current.targetX || motionRef.current.y !== motionRef.current.targetY) {
				animationFrameRef.current = requestAnimationFrame(tick)
			}
		}
		animationFrameRef.current = requestAnimationFrame(tick)

		return () => {
			cancelAnimationFrame(animationFrameRef.current)
		}
	}, [input.cursor, input.viewport])

	return (
		<div
			ref={nodeRef}
			aria-hidden
			className="pointer-events-none fixed top-0 left-0 z-5 transform-(--cursor-transform) will-change-transform"
			style={{'--cursor-color': input.cursor.color}}
		>
			<CursorLabel label={input.cursor.name} />
		</div>
	)
}

// The system pointer is hidden, so this one rides above the page on the pointer's own CSS variables.
function OwnCursor(input: {cursor: PortfolioVisitor; viewport: {width: number; height: number}}) {
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed top-0 left-0 z-20 transform-(--cursor-transform)"
			style={{
				'--cursor-color': input.cursor.color,
				'--cursor-transform': `translate3d(var(--pointer-x, ${input.cursor.x * input.viewport.width}px), var(--pointer-y, ${input.cursor.y * input.viewport.height}px), 0)`
			}}
		>
			<CursorLabel label={`${input.cursor.name} (you)`} />
		</div>
	)
}

function Section(input: {className?: string; children: React.ReactNode}) {
	return (
		<section
			className={cn(
				'relative z-10 flex flex-col items-center overflow-hidden px-3 py-4 sm:px-6 sm:py-6',
				input.className
			)}
		>
			{input.children}
		</section>
	)
}

// A section of the column: its lowercase mono name over the rows a hairline splits.
function SectionBody(input: {children: React.ReactNode; title: string}) {
	return (
		<Panel className="flex w-full max-w-3xl flex-col px-4 py-3 sm:px-6">
			<h2 className="text-muted-foreground border-border border-b pb-2 font-mono text-xs">{input.title}</h2>
			<div className="divide-border flex flex-col divide-y">{input.children}</div>
		</Panel>
	)
}

function HeroSection() {
	return (
		<Section className="pt-10 sm:pt-20">
			<Panel className="flex w-full max-w-3xl flex-col gap-3 px-4 py-6 sm:px-6">
				<h1 className="text-foreground text-4xl font-semibold tracking-tight sm:text-5xl">
					{profile.firstName} {profile.lastName}
				</h1>
				<p className="text-primary font-mono text-sm">{profile.title}</p>
				<p className="text-foreground/90 text-base">{summary}</p>
				<p className="text-muted-foreground font-mono text-xs">{profile.location}</p>
			</Panel>
		</Section>
	)
}

function SkillsSection() {
	return (
		<Section>
			<SectionBody title="skills">
				{Array.map(skills, skill => (
					<div key={skill.area} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
						<h3 className="flex w-40 shrink-0 items-center gap-2 text-sm font-medium">
							<skill.icon className="text-primary size-4" />
							{skill.area}
						</h3>
						<p className="text-muted-foreground text-sm">{skill.items}</p>
					</div>
				))}
			</SectionBody>
		</Section>
	)
}

function ProjectRow(input: {project: {description: string; href: string; name: string; role: string; stack: string}}) {
	return (
		<div className="flex flex-col gap-1 py-3">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="text-sm font-medium">
					{input.project.name}
					<span className="text-muted-foreground ml-2 font-normal">{input.project.role}</span>
				</h3>
				<a
					href={input.project.href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`View ${input.project.name} on GitHub`}
					className="text-primary hover:text-primary/80 transition-colors"
				>
					<ArrowUpRight className="size-4" />
				</a>
			</div>
			<p className="text-foreground/90 text-sm">{input.project.description}</p>
			<p className="text-muted-foreground font-mono text-xs">{input.project.stack}</p>
		</div>
	)
}

function ProjectsSection() {
	return (
		<Section>
			<SectionBody title="projects">
				{Array.map(projects, project => (
					<ProjectRow key={project.name} project={project} />
				))}
			</SectionBody>
		</Section>
	)
}

function ExperienceSection() {
	return (
		<Section>
			<SectionBody title="experience">
				{Array.map(experience, job => (
					<div key={job.company} className="flex flex-col gap-2 py-3">
						<div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
							<h3 className="text-sm font-medium">
								{job.company}
								<span className="text-muted-foreground ml-2 font-normal">
									{job.role}
									{Predicate.isNotUndefined(job.note) && ` · ${job.note}`}
								</span>
							</h3>
							<p className="text-muted-foreground font-mono text-xs sm:text-right">
								{pipe([job.period, job.location], Array.filter(Predicate.isNotUndefined), Array.join(' · '))}
							</p>
						</div>
						<ul className="flex flex-col gap-1">
							{Array.map(job.highlights, highlight => (
								<li key={highlight} className="text-foreground/90 flex items-start gap-2 text-sm">
									<span className="bg-muted-foreground mt-2 size-1 shrink-0 rounded-full" aria-hidden="true" />
									<span>{highlight}</span>
								</li>
							))}
						</ul>
					</div>
				))}
			</SectionBody>
		</Section>
	)
}

function EducationSection() {
	return (
		<Section>
			<SectionBody title="education and languages">
				{Array.map(education, entry => (
					<div key={entry.school} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
						<h3 className="text-sm font-medium">
							{entry.school}
							<span className="text-muted-foreground ml-2 font-normal">
								{entry.degree}
								{Predicate.isNotUndefined(entry.grade) && ` (${entry.grade})`}
							</span>
						</h3>
						<span className="text-muted-foreground font-mono text-xs">{entry.period}</span>
					</div>
				))}
				<div className="flex flex-wrap gap-x-6 gap-y-1 py-3">
					{Array.map(languages, lang => (
						<span key={lang.language} className="text-sm">
							<span className="font-medium">{lang.language}</span>
							<span className="text-muted-foreground ml-2 font-mono text-xs">{lang.level}</span>
						</span>
					))}
				</div>
			</SectionBody>
		</Section>
	)
}

function ContactSection() {
	return (
		<Section>
			<SectionBody title="contact">
				{Array.map(
					[
						contacts.email,
						contacts.pec,
						contacts.phone,
						contacts.github,
						{href: '/cv', label: 'CV', value: `${profile.portfolio}/cv`}
					],
					item => (
						<a
							key={item.label}
							href={item.href}
							className="hover:text-primary flex items-baseline justify-between gap-3 py-3 text-sm transition-colors"
							target="_blank"
							rel="noopener noreferrer"
						>
							<span className="text-muted-foreground">{item.label}</span>
							<span className="font-mono text-xs break-all">{item.value}</span>
						</a>
					)
				)}
			</SectionBody>
			<p className="text-muted-foreground mt-4 font-mono text-xs">
				© 2026 {profile.firstName} {profile.lastName} · VAT {profile.vat}
			</p>
		</Section>
	)
}

function ShortcutsOverlay(input: {open: boolean; onOpenChange: (open: boolean) => void}) {
	return (
		<Dialog open={input.open} onOpenChange={input.onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
				</DialogHeader>
				<div className="text-muted-foreground grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-xs sm:gap-x-8">
					<KbdGroup>
						<Kbd>j</Kbd>
						<Kbd>k</Kbd>
					</KbdGroup>
					<span>next / prev section</span>
					<KbdGroup>
						<Kbd>1</Kbd>–<Kbd>6</Kbd>
					</KbdGroup>
					<span>jump to section</span>
					<Kbd>r</Kbd>
					<span>change cursor color</span>
					<Kbd>?</Kbd>
					<span>toggle this overlay</span>
					<Kbd>Esc</Kbd>
					<span>close this overlay</span>
				</div>
			</DialogContent>
		</Dialog>
	)
}

function RealtimeLayer(input: {viewport: {width: number; height: number}}) {
	const portfolio = useAtomSuspense(portfolioAtom)

	return (
		<>
			<div className="trail-grid pointer-events-none fixed inset-0 z-1" />
			<TrailCanvas trails={portfolio.value.trails} viewport={input.viewport} />

			{Array.map(portfolio.value.visitors, cursor => {
				if (cursor.id === identity.id) return <OwnCursor key={cursor.id} cursor={cursor} viewport={input.viewport} />
				return <VisitorCursor key={cursor.id} cursor={cursor} viewport={input.viewport} />
			})}

			<div className="border-border bg-background pointer-events-none fixed bottom-3 left-3 z-50 flex h-7 items-center gap-2 rounded-md border px-2 font-mono text-xs sm:bottom-4 sm:left-4">
				<span
					className="size-1.5 rounded-full bg-(--identity-color)"
					style={{
						'--identity-color': pipe(
							Array.findFirst(portfolio.value.visitors, visitor => visitor.id === identity.id),
							Option.match({onNone: () => identity.color, onSome: visitor => visitor.color})
						)
					}}
				/>
				<span className="text-primary">{Array.length(portfolio.value.visitors)}</span>
				<span className="text-muted-foreground">
					{Boolean.match(Array.length(portfolio.value.visitors) === 1, {
						onFalse: () => 'visitors',
						onTrue: () => 'visitor'
					})}
				</span>
			</div>
		</>
	)
}

function PortfolioRoute() {
	const viewport = {
		height: useSyncExternalStore(
			subscribeToResize,
			() => window.innerHeight,
			() => 0
		),
		width: useSyncExternalStore(
			subscribeToResize,
			() => window.innerWidth,
			() => 0
		)
	}
	const containerRef = useRef<HTMLDivElement>(null)
	const currentSectionRef = useRef(0)
	const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
	const pointerFrameRef = useRef(0)
	const pointerRef = useRef<{x: number; y: number}>(null)
	const lastSentPointerRef = useRef<{sentAt: number; x: number; y: number}>(null)
	// The colour this page last sent; the server's echo can lag behind a recolour.
	const colorRef = useRef(identity.color)
	const [showShortcuts, setShowShortcuts] = useState(false)

	useEffect(
		() => () => {
			cancelAnimationFrame(pointerFrameRef.current)
		},
		[]
	)

	function sections() {
		return Array.fromIterable(containerRef.current?.querySelectorAll<HTMLElement>(':scope > section') ?? [])
	}

	function scrollTo(index: number) {
		const target = sections()[index]
		if (Predicate.isUndefined(target)) return

		target.scrollIntoView({behavior: 'smooth', block: 'start'})
		currentSectionRef.current = index
	}

	function send(pointer: {x: number; y: number}) {
		lastSentPointerRef.current = {sentAt: performance.now(), x: pointer.x, y: pointer.y}
		moveRpc({payload: {color: colorRef.current, id: identity.id, x: pointer.x, y: pointer.y}})
	}

	function updateColor() {
		colorRef.current = pickNextCursorColor(colorRef.current)
		send(pointerRef.current ?? lastSentPointerRef.current ?? {x: 0.5, y: 0.5})
	}

	// At most one move per 50 ms, carrying the latest pointer position; true waits for the next frame.
	function flushPointer() {
		if (pointerRef.current !== null && lastSentPointerRef.current !== null) {
			if (!hasMeaningfulMove(lastSentPointerRef.current, pointerRef.current)) return false
			if (performance.now() - lastSentPointerRef.current.sentAt < 50) return true
		}
		if (pointerRef.current !== null) send(pointerRef.current)
		return false
	}

	function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
		event.currentTarget.style.setProperty('--pointer-x', `${event.clientX}px`)
		event.currentTarget.style.setProperty('--pointer-y', `${event.clientY}px`)
		if (viewport.width === 0 || viewport.height === 0) return

		pointerRef.current = {
			x: Number.clamp({maximum: 0.999999, minimum: 0})(event.clientX / viewport.width),
			y: Number.clamp({maximum: 0.999999, minimum: 0})(event.clientY / viewport.height)
		}
		if (pointerFrameRef.current === 0) {
			eachFrame(flushPointer, frame => {
				pointerFrameRef.current = frame
			})
		}
	}

	useHotkeys([
		{
			callback: () => {
				scrollTo(Number.min(currentSectionRef.current + 1, SECTION_KEYS.length - 1))
			},
			hotkey: 'J'
		},
		{
			callback: () => {
				scrollTo(Number.max(currentSectionRef.current - 1, 0))
			},
			hotkey: 'K'
		},
		...Array.map(SECTION_KEYS, (hotkey, index) => ({
			callback: () => {
				scrollTo(index)
			},
			hotkey
		})),
		{callback: updateColor, hotkey: 'R'},
		{
			callback: () => {
				setShowShortcuts(show => !show)
			},
			hotkey: {key: '?', shift: true}
		}
	])

	return (
		<div
			ref={containerRef}
			className="relative min-h-0 flex-1 cursor-none overflow-x-hidden overflow-y-scroll"
			onPointerMove={updatePointer}
			onScroll={event => {
				const viewportMiddle = event.currentTarget.scrollTop + event.currentTarget.clientHeight / 2
				currentSectionRef.current = pipe(
					sections(),
					Array.findLastIndex(section => section.offsetTop <= viewportMiddle),
					Option.getOrElse(() => 0)
				)
			}}
		>
			<HeroSection />
			<SkillsSection />
			<ExperienceSection />
			<ProjectsSection />
			<EducationSection />
			<ContactSection />

			<Suspense fallback={null}>
				<RealtimeLayer viewport={viewport} />
			</Suspense>

			<Button
				variant="outline"
				size="icon"
				aria-expanded={showShortcuts}
				aria-haspopup="dialog"
				aria-label="Toggle keyboard shortcuts"
				onClick={() => {
					setShowShortcuts(show => !show)
				}}
				className="fixed right-3 bottom-3 z-50 sm:right-4 sm:bottom-4"
			>
				?
			</Button>

			<ShortcutsOverlay open={showShortcuts} onOpenChange={setShowShortcuts} />
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({
	component: PortfolioRoute,
	head: () => ({
		meta: [
			{title: `${profile.firstName} ${profile.lastName} – ${profile.title}`},
			{content: `${profile.firstName} ${profile.lastName}`, name: 'author'},
			{content: summary, name: 'description'}
		]
	})
})
