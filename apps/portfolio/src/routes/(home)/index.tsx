import {useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Effect,
	Function,
	HashMap,
	HashSet,
	MutableList,
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

import {
	ArrowUpRightIcon,
	CursorIcon,
	EnvelopeIcon,
	FileTextIcon,
	GithubLogoIcon,
	PhoneIcon,
	SealCheckIcon
} from '@phosphor-icons/react'
import {useHotkeys} from '@tanstack/react-hotkeys'
import {CatchBoundary, createFileRoute} from '@tanstack/react-router'
import {Atom} from 'effect/reactivity'
import {Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Kbd, KbdGroup} from '@deslop/components-web/ui/kbd'
import {cn} from '@deslop/components-web/utils'

import {hasMeaningfulMove} from '#lib/portfolio.ts'
import {contacts, education, experience, languages, profile, projects, skills, summary} from '#lib/profile.ts'
import {RpcClient} from '#lib/utils.ts'
import {PortfolioColor} from '#services/presence/schema.ts'
import type {PortfolioScene, PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6'] as const
const SECTION_NAMES = ['profile', 'skills', 'experience', 'projects', 'education', 'contact'] as const

type Scene = {bots: PortfolioVisitors; trails: PortfolioVisitors; visitors: PortfolioVisitors}

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
			Stream.mapAccum<Scene, PortfolioScene, Scene>(
				() => ({bots: [], trails: [], visitors: []}),
				(scene, update) => {
					const cursors = Array.appendAll(update.visitors, update.bots)
					const positions = HashSet.fromIterable(
						Array.map(Array.appendAll(scene.visitors, scene.bots), visitor =>
							Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y)
						)
					)
					// The latest 180 positions in the order cursors reached them; a recolour starts a new stretch where the cursor is.
					const next = {
						bots: update.bots,
						trails: Array.takeRight(
							Array.appendAll(
								scene.trails,
								Array.filter(
									cursors,
									visitor => !HashSet.has(positions, Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y))
								)
							),
							180
						),
						visitors: update.visitors
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

// The page's content over the trail grid: one opaque column, rows split by hairlines; its words select like a document's.
function Panel(input: {className?: string; children: React.ReactNode}) {
	return <div className={cn('panel-frosted border-border border select-text', input.className)}>{input.children}</div>
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

// A section of the column; its name stays for assistive technology, not on the card.
function SectionBody(input: {children: React.ReactNode; title: string}) {
	return (
		<Panel className="flex w-full max-w-3xl flex-col p-4 sm:p-6">
			<h2 className="sr-only">{input.title}</h2>
			{input.children}
		</Panel>
	)
}

function TrailGrid(input: {trails: PortfolioVisitors; viewport: {width: number; height: number}}) {
	const cells = MutableList.make<{color: string; x: number; y: number}>()
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
				MutableList.append(cells, {color: current.trail.color, x: current.col * 26 + 1, y: current.row * 26 + 1})
				return HashMap.set(previousByVisitor, trail.id, current)
			}

			const stepCount = Number.max(Math.abs(current.col - previous.col), Math.abs(current.row - previous.row))

			for (const step of Array.makeBy(stepCount + 1, Function.identity)) {
				const progress = Boolean.match(stepCount === 0, {onFalse: () => step / stepCount, onTrue: () => 1})
				const col = Number.round(previous.col + (current.col - previous.col) * progress, 0)
				const row = Number.round(previous.row + (current.row - previous.row) * progress, 0)

				const color = Boolean.match(progress < 1, {
					onFalse: () => current.trail.color,
					onTrue: () => previous.trail.color
				})
				MutableList.append(cells, {color, x: col * 26 + 1, y: row * 26 + 1})
			}

			return HashMap.set(previousByVisitor, trail.id, current)
		}
	)

	return (
		<svg
			aria-hidden
			className="pointer-events-none fixed inset-0 z-1 size-full print:hidden"
			shapeRendering="crispEdges"
		>
			{Array.map(MutableList.toArray(cells), (cell, index) => (
				<rect key={index} x={cell.x} y={cell.y} width={24} height={24} fill={cell.color} fillOpacity={0.22} />
			))}
		</svg>
	)
}

function CursorLabel(input: {flip?: boolean; label: string; show?: boolean}) {
	return (
		<div className={cn('flex items-center gap-1', input.flip === true && '-translate-x-full flex-row-reverse')}>
			<CursorIcon className="size-4 text-(--cursor-color)" />
			{Boolean.match(input.show === false, {
				onFalse: () => (
					<span className="bg-background text-foreground rounded-none border border-(--cursor-color) px-1.5 py-0.5 font-mono text-xs leading-none whitespace-nowrap">
						{input.label}
					</span>
				),
				onTrue: () => null
			})}
		</div>
	)
}

// An 8px glyph plus 28px for the icon and padding.
function labelWidth(label: string) {
	return label.length * 8 + 28
}

function labelOverReadingColumn(x: number, viewport: {width: number}, label: string) {
	const at = x * viewport.width
	const width = labelWidth(label)
	const left = (viewport.width - 768) / 2
	const right = (viewport.width + 768) / 2
	if (at < left) return at + width > left
	return at <= right || at - width < right
}

// Another visitor's cursor sits at each position the server reports.
function VisitorCursor(input: {cursor: PortfolioVisitor; viewport: {width: number; height: number}}) {
	const nodeRef = useRef<HTMLDivElement>(null)

	// Before paint, so the cursor's first frame is already where the server put it.
	useLayoutEffect(() => {
		if (nodeRef.current !== null) {
			setCursorTransform(nodeRef.current, input.cursor.x * input.viewport.width, input.cursor.y * input.viewport.height)
		}
	}, [input.cursor, input.viewport])

	return (
		<div
			ref={nodeRef}
			aria-hidden
			className="pointer-events-none fixed top-0 left-0 z-5 transform-(--cursor-transform)"
			style={{'--cursor-color': input.cursor.color}}
		>
			<CursorLabel
				flip={input.cursor.x * input.viewport.width + labelWidth(input.cursor.name) > input.viewport.width - 8}
				label={input.cursor.name}
				show={!labelOverReadingColumn(input.cursor.x, input.viewport, input.cursor.name)}
			/>
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
			<CursorLabel
				flip={input.cursor.x * input.viewport.width + labelWidth('You') > input.viewport.width - 8}
				label="You"
				show={!labelOverReadingColumn(input.cursor.x, input.viewport, 'You')}
			/>
		</div>
	)
}

// The masthead is the first panel: role and place set the stage, the name is the one display statement.
function ProfileSection() {
	return (
		<Section>
			<Panel className="mt-6 flex w-full max-w-3xl flex-col gap-3 px-4 py-6 sm:mt-14 sm:px-6">
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
						<h3 className="flex w-40 shrink-0 items-center gap-2 text-sm font-medium sm:self-start">
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
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-sm font-medium">
					{input.project.name}
					<span className="text-muted-foreground ml-2 font-normal">{input.project.role}</span>
				</h3>
				<a
					href={input.project.href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`View ${input.project.name} on GitHub`}
					className="project-link text-primary hover:text-primary/80"
				>
					<ArrowUpRightIcon className="size-4" />
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
		<Section className="pb-20">
			<SectionBody title="contact">
				{Array.map(
					[
						{...contacts.email, icon: EnvelopeIcon},
						{...contacts.pec, icon: SealCheckIcon},
						{...contacts.phone, icon: PhoneIcon},
						{...contacts.github, icon: GithubLogoIcon},
						{href: '/cv', icon: FileTextIcon, label: 'CV', value: `${profile.portfolio}/cv`}
					],
					item => {
						const internal = String.startsWith('/')(item.href)
						return (
							<a
								key={item.label}
								href={item.href}
								className="hover:text-primary flex h-7 items-center gap-2 text-sm"
								target={Boolean.match(internal, {onFalse: () => '_blank' as const, onTrue: () => undefined})}
								rel={Boolean.match(internal, {onFalse: () => 'noopener noreferrer' as const, onTrue: () => undefined})}
							>
								<item.icon aria-hidden="true" className="text-primary size-4 shrink-0" />
								<span className="text-muted-foreground">{item.label}</span>
								<span className="ml-auto text-right font-mono text-xs break-all">{item.value}</span>
							</a>
						)
					}
				)}
			</SectionBody>
		</Section>
	)
}

// The shortcut legend is the page's panel in miniature: one row per action.
function ShortcutRow(input: {keys: React.ReactNode; label: string; title?: string}) {
	return (
		<div className="flex min-h-9 items-center justify-between gap-6 py-2">
			<span className="text-sm" title={input.title}>
				{input.label}
			</span>
			{input.keys}
		</div>
	)
}

function ShortcutsOverlay(input: {open: boolean; onOpenChange: (open: boolean) => void}) {
	return (
		<Dialog open={input.open} onOpenChange={input.onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Shortcuts</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col">
					<ShortcutRow
						keys={
							<KbdGroup>
								<Kbd>1</Kbd>–<Kbd>6</Kbd>
							</KbdGroup>
						}
						label="Jump to a section"
						title={pipe(
							Array.map(SECTION_NAMES, (name, index) => `${index + 1} ${name}`),
							Array.join(' · ')
						)}
					/>
					<ShortcutRow keys={<Kbd>r</Kbd>} label="Change cursor color" />
					<ShortcutRow keys={<Kbd>?</Kbd>} label="Toggle this panel" />
					<ShortcutRow keys={<Kbd>Esc</Kbd>} label="Close this panel" />
				</div>
			</DialogContent>
		</Dialog>
	)
}

function VisitorCount(props: {visitors: PortfolioVisitors}) {
	return (
		<>
			<span
				className="size-1.5 rounded-full bg-(--identity-color)"
				style={{
					'--identity-color': pipe(
						Array.findFirst(props.visitors, visitor => visitor.id === identity.id),
						Option.match({onNone: () => identity.color, onSome: visitor => visitor.color})
					)
				}}
			/>
			<span className="text-foreground tabular-nums">{Array.length(props.visitors)}</span>
			<span className="text-muted-foreground">
				{Boolean.match(Array.length(props.visitors) === 1, {onFalse: () => 'visitors', onTrue: () => 'visitor'})}
			</span>
		</>
	)
}

// Italian law asks a VAT holder's website to show the number on its home page.
const LEGAL_LINE = `© 2026 ${profile.firstName} ${profile.lastName} · VAT ${profile.vat}`
const LEGAL_LINE_NARROW = `© 2026 · VAT ${profile.vat}`

// Presence is a quiet line at the page's edge: live count, connecting, or unavailable, never a hero.
function PresenceHud(input: {
	state: 'connecting' | 'live' | 'offline'
	visitors?: PortfolioVisitors
	onToggleShortcuts?: () => void
	shortcutsOpen?: boolean
}) {
	return (
		<div className="border-border bg-background/95 pr-safe-right pb-safe-bottom pl-safe-left pointer-events-none fixed inset-x-0 bottom-0 z-50 border-t font-mono text-xs backdrop-blur print:hidden">
			<div className="relative flex min-h-10 items-center justify-between px-3 sm:px-4">
				<span className="flex min-w-0 items-center gap-2">
					{Boolean.match(input.state === 'live' && Predicate.isNotUndefined(input.visitors), {
						onFalse: () => (
							<>
								<span className="bg-muted-foreground/50 size-1.5 rounded-full" />
								<span className="text-muted-foreground truncate">
									{Boolean.match(input.state === 'offline', {
										onFalse: () => 'presence connecting',
										onTrue: () => 'presence unavailable'
									})}
								</span>
							</>
						),
						onTrue: () => <VisitorCount visitors={input.visitors ?? []} />
					})}
				</span>
				<span className="text-muted-foreground absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap sm:inline">
					{LEGAL_LINE}
				</span>
				<span className="text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap sm:hidden">
					{LEGAL_LINE_NARROW}
				</span>
				{Predicate.isNotUndefined(input.onToggleShortcuts) && (
					<Button
						variant="ghost"
						size="xs"
						aria-expanded={input.shortcutsOpen === true}
						aria-haspopup="dialog"
						aria-label="Toggle keyboard shortcuts"
						onClick={input.onToggleShortcuts}
						className="pointer-events-auto -mr-1"
					>
						?
					</Button>
				)}
			</div>
		</div>
	)
}

function RealtimeLayer(input: {
	viewport: {width: number; height: number}
	onToggleShortcuts: () => void
	shortcutsOpen: boolean
}) {
	const portfolio = useAtomSuspense(portfolioAtom)

	return (
		<>
			<div className="trail-grid pointer-events-none fixed inset-0 z-1 print:hidden" />
			<TrailGrid trails={portfolio.value.trails} viewport={input.viewport} />

			<div className="hidden print:hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
				<OwnCursor
					cursor={Option.getOrElse(
						Array.findFirst(portfolio.value.visitors, visitor => visitor.id === identity.id),
						() => ({color: identity.color, id: identity.id, name: identity.name, x: 0.5, y: 0.5})
					)}
					viewport={input.viewport}
				/>
			</div>
			<div className="max-sm:hidden print:hidden">
				<div className="hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
					{Array.map(Array.appendAll(portfolio.value.visitors, portfolio.value.bots), cursor =>
						Boolean.match(cursor.id === identity.id, {
							onFalse: () => <VisitorCursor key={cursor.id} cursor={cursor} viewport={input.viewport} />,
							onTrue: () => null
						})
					)}
				</div>
			</div>

			<PresenceHud
				state="live"
				visitors={portfolio.value.visitors}
				onToggleShortcuts={input.onToggleShortcuts}
				shortcutsOpen={input.shortcutsOpen}
			/>
		</>
	)
}

function PresenceUnavailable() {
	return <PresenceHud state="offline" />
}

// oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- The portfolio is one keyboard-scrolling region; it needs focus and paging keys.
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

	function toggleShortcuts() {
		setShowShortcuts(show => !show)
	}

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

		// A frequent keyboard jump lands at once; the scroll event then reads the section at the top.
		target.scrollIntoView({behavior: 'auto', block: 'start'})
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
		// A swipe scrolls the page; only a hovering pointer paints a trail.
		if (event.pointerType === 'touch') return
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
		...Array.map(SECTION_KEYS, (hotkey, index) => ({
			callback: () => {
				scrollTo(index)
			},
			hotkey
		})),
		{callback: updateColor, hotkey: 'R'},
		{callback: toggleShortcuts, hotkey: {key: '?', shift: true}}
	])

	return (
		<div
			ref={containerRef}
			aria-label="Portfolio"
			role="region"
			className="portfolio-page focus-visible:ring-border relative min-h-0 flex-1 overflow-x-hidden overflow-y-scroll overscroll-contain focus-visible:ring-1 focus-visible:ring-inset print:h-auto print:overflow-visible [@media(hover:hover)_and_(pointer:fine)]:cursor-none"
			onKeyDown={event => {
				if (event.target !== event.currentTarget) return
				const page = event.currentTarget.clientHeight * 0.9
				if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault()
					event.currentTarget.scrollTo({
						top: Boolean.match(event.key === 'Home', {onFalse: () => event.currentTarget.scrollHeight, onTrue: () => 0})
					})
					return
				}
				if (event.key === ' ') {
					event.preventDefault()
					event.currentTarget.scrollBy({top: Boolean.match(event.shiftKey, {onFalse: () => page, onTrue: () => -page})})
					return
				}
				const amount = {ArrowDown: 80, ArrowUp: -80, PageDown: page, PageUp: -page}[event.key]
				if (amount !== undefined) {
					event.preventDefault()
					event.currentTarget.scrollBy({top: amount})
				}
			}}
			onPointerMove={updatePointer}
			onScroll={event => {
				currentSectionRef.current = Boolean.match(
					event.currentTarget.scrollTop + event.currentTarget.clientHeight >= event.currentTarget.scrollHeight - 2,
					{
						onFalse: () =>
							pipe(
								sections(),
								Array.findLastIndex(section => section.offsetTop <= event.currentTarget.scrollTop + 2),
								Option.getOrElse(() => 0)
							),
						onTrue: () => Number.max(0, sections().length - 1)
					}
				)
			}}
			tabIndex={0}
		>
			<ProfileSection />
			<SkillsSection />
			<ExperienceSection />
			<ProjectsSection />
			<EducationSection />
			<ContactSection />

			<CatchBoundary getResetKey={() => 'presence'} errorComponent={PresenceUnavailable}>
				<Suspense
					fallback={
						<>
							<div className="hidden print:hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
								<OwnCursor
									cursor={{color: identity.color, id: identity.id, name: identity.name, x: 0.5, y: 0.5}}
									viewport={viewport}
								/>
							</div>
							<PresenceHud state="connecting" onToggleShortcuts={toggleShortcuts} shortcutsOpen={showShortcuts} />
						</>
					}
				>
					<RealtimeLayer viewport={viewport} onToggleShortcuts={toggleShortcuts} shortcutsOpen={showShortcuts} />
				</Suspense>
			</CatchBoundary>

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
