import {useAtomMount, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Effect,
	Function,
	HashMap,
	HashSet,
	Match,
	MutableList,
	Number,
	Option,
	Predicate,
	Random,
	Schema,
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
import {SecureRandom} from 'effect/crypto'
import {KeyValueStore} from 'effect/persistence'
import {Atom} from 'effect/reactivity'
import {Suspense, useRef, useState} from 'react'

import {cn} from '@deslop/components-web/classes'
import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Kbd, KbdGroup} from '@deslop/components-web/ui/kbd'
import {liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'

import {RpcClient} from '#lib/presence.ts'
import {contacts, education, experience, languages, profile, projects, skills, summary} from '#lib/profile.ts'
import {hasMeaningfulMove} from '#services/presence/lib/utils.ts'
import {Color, VisitorId} from '#services/presence/schema.ts'
import type {Scene, Visitor, Visitors} from '#services/presence/schema.ts'

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6'] as const
const SECTION_NAMES = ['profile', 'skills', 'experience', 'projects', 'education', 'contact'] as const

type TrailedScene = Scene & {trails: Visitors}

function randomIndex(length: number) {
	return Math.floor(Random.Random.defaultValue().nextDoubleUnsafe() * length)
}

function pickNextCursorColor(currentColor: Color) {
	const nextPalette = Array.filter(Color.literals, color => color !== currentColor)
	return nextPalette[randomIndex(Array.length(nextPalette))] ?? Color.literals[0]
}

const identityAtom = Atom.keepAlive(
	Atom.kvs({
		defaultValue: () => {
			const seed = String.slice(0, 6)(SecureRandom.uuidV4Unsafe())
			return {id: VisitorId.make(`v-${seed}`), name: `Guest-${String.slice(0, 3)(seed)}`}
		},
		key: 'portfolio.identity',
		mode: 'async',
		runtime: Atom.runtime(KeyValueStore.layerStorage(() => sessionStorage)),
		schema: Schema.Struct({id: VisitorId, name: Schema.NonEmptyString})
	})
)

// Pointer movement is local; the joined scene supplies the colour shared by tabs of the same identity.
const ownCursorAtom = Atom.make({
	color: Color.literals[randomIndex(Array.length(Color.literals))] ?? Color.literals[0],
	x: 0.5,
	y: 0.5
})

const portfolioAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		Stream.unwrap(
			Effect.map(get.result(identityAtom), identity =>
				pipe(
					liveStream(RpcClient, 'presence.join', {...identity, color: get.once(ownCursorAtom).color}),
					// A dropped socket rejoins with the trails kept, instead of turning the page into an error.
					reconnectOnDrop,
					Stream.mapAccum<TrailedScene, Scene, TrailedScene>(
						() => ({bots: [], trails: [], visitors: []}),
						(scene, update) => {
							const cursors = Array.appendAll(update.visitors, update.bots)
							const positions = HashSet.fromIterable(
								pipe(
									scene.visitors,
									Array.appendAll(scene.bots),
									Array.map(visitor => Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y))
								)
							)
							// The latest 180 positions in the order cursors reached them; a recolour starts a new stretch where the cursor is.
							const next = {
								bots: update.bots,
								trails: pipe(
									scene.trails,
									Array.appendAll(
										Array.filter(
											cursors,
											visitor => !HashSet.has(positions, Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y))
										)
									),
									Array.takeRight(180)
								),
								visitors: update.visitors
							}
							return Tuple.make(next, [next])
						}
					)
				)
			)
		)
	)
)

// Sends this page's cursor while the page is open: at most one move per 50 ms, always the latest, and none too small to see unless the colour changed.
const sendCursorAtom = RpcClient.runtime.atom(get =>
	Effect.gen(function* () {
		const identity = yield* get.result(identityAtom)
		return yield* pipe(
			get.stream(ownCursorAtom, {withoutInitialValue: true}),
			Stream.changesWith((sent, next) => sent.color === next.color && !hasMeaningfulMove(sent, next)),
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.throttle({cost: Array.length, duration: '50 millis', units: 1}),
			Stream.runForEach(cursor =>
				pipe(
					RpcClient,
					Effect.flatMap(client => client('presence.move', {...cursor, id: identity.id})),
					Effect.ignore({log: 'Debug', message: 'The cursor move did not reach the room'})
				)
			)
		)
	})
)

// The window's size in pixels, following each resize.
const viewportAtom = Atom.make(get => {
	function onResize() {
		get.setSelf({height: innerHeight, width: innerWidth})
	}
	addEventListener('resize', onResize)
	get.addFinalizer(() => removeEventListener('resize', onResize))
	return {height: innerHeight, width: innerWidth}
})

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

function TrailGrid(input: {trails: Visitors; viewport: {width: number; height: number}}) {
	const cells = MutableList.make<{color: string; x: number; y: number}>()
	Array.reduce(
		input.trails,
		HashMap.empty<VisitorId, {trail: Visitor; col: number; row: number}>(),
		(previousByVisitor, trail) => {
			const current = {
				col: Math.floor((trail.x * input.viewport.width) / 26),
				row: Math.floor((trail.y * input.viewport.height) / 26),
				trail
			}
			const previous = pipe(
				previousByVisitor,
				HashMap.get(trail.id),
				Option.getOrElse(() => current)
			)

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

// Visitors use server positions; the hidden system pointer's replacement follows local CSS variables above them.
function Cursor(input: {cursor: Visitor; own: boolean; viewport: {width: number; height: number}}) {
	const label = Boolean.match(input.own, {onFalse: () => input.cursor.name, onTrue: () => 'You'})
	const x = `${input.cursor.x * input.viewport.width}px`
	const y = `${input.cursor.y * input.viewport.height}px`
	return (
		<div
			aria-hidden
			className={cn(
				'pointer-events-none fixed top-0 left-0 transform-(--cursor-transform)',
				Boolean.match(input.own, {onFalse: () => 'z-5', onTrue: () => 'z-20'})
			)}
			style={{
				'--cursor-color': input.cursor.color,
				'--cursor-transform': Boolean.match(input.own, {
					onFalse: () => `translate3d(${x}, ${y}, 0)`,
					onTrue: () => `translate3d(var(--pointer-x, ${x}), var(--pointer-y, ${y}), 0)`
				})
			}}
		>
			<CursorLabel
				flip={input.cursor.x * input.viewport.width + labelWidth(label) > input.viewport.width - 8}
				label={label}
				show={!labelOverReadingColumn(input.cursor.x, input.viewport, label)}
			/>
		</div>
	)
}

function OwnCursor(input: {viewport: {width: number; height: number}; color: Option.Option<Color>}) {
	const cursor = useAtomValue(ownCursorAtom)
	return (
		<div className="hidden print:hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
			<Cursor
				own
				cursor={{
					...cursor,
					color: Option.getOrElse(input.color, () => cursor.color),
					id: VisitorId.make('own'),
					name: 'You'
				}}
				viewport={input.viewport}
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
				{/* The arrow keeps a 44px phone target without making its line taller than the title. */}
				<a
					href={input.project.href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`View ${input.project.name} on GitHub`}
					className="text-primary hover:text-primary/80 max-sm:relative max-sm:inline-flex max-sm:size-5 max-sm:items-center max-sm:justify-center max-sm:after:absolute max-sm:after:-inset-3"
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
							SECTION_NAMES,
							Array.map((name, index) => `${index + 1} ${name}`),
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

function VisitorCount(props: {visitors: Visitors}) {
	const identity = useAtomSuspense(identityAtom).value
	const cursor = useAtomValue(ownCursorAtom)
	return (
		<>
			<span
				className="size-1.5 rounded-full bg-(--identity-color)"
				style={{
					'--identity-color': pipe(
						props.visitors,
						Array.findFirst(visitor => visitor.id === identity.id),
						Option.match({onNone: () => cursor.color, onSome: visitor => visitor.color})
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

function PresenceHud(input: {
	presence: Visitors | 'connecting' | 'offline'
	onToggleShortcuts: () => void
	shortcutsOpen: boolean
}) {
	return (
		<div className="border-border bg-background/95 pr-safe-right pb-safe-bottom pl-safe-left pointer-events-none fixed inset-x-0 bottom-0 z-50 border-t font-mono text-xs backdrop-blur print:hidden">
			<div className="relative flex min-h-10 items-center justify-between px-3 sm:px-4">
				<span className="flex min-w-0 items-center gap-2">
					{pipe(
						Match.value(input.presence),
						Match.when(Predicate.isString, state => (
							<>
								<span className="bg-muted-foreground/50 size-1.5 rounded-full" />
								<span className="text-muted-foreground truncate">
									{Boolean.match(state === 'offline', {
										onFalse: () => 'presence connecting',
										onTrue: () => 'presence unavailable'
									})}
								</span>
							</>
						)),
						Match.orElse(visitors => <VisitorCount visitors={visitors} />)
					)}
				</span>
				<span className="text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap max-sm:static max-sm:translate-x-0 max-sm:translate-y-0 pointer-coarse:static pointer-coarse:translate-x-0 pointer-coarse:translate-y-0">
					<span className="hidden sm:inline">{LEGAL_LINE}</span>
					<span className="sm:hidden">{LEGAL_LINE_NARROW}</span>
				</span>
				<Button
					variant="ghost"
					size="xs"
					aria-expanded={input.shortcutsOpen}
					aria-haspopup="dialog"
					aria-label="Toggle keyboard shortcuts"
					onClick={input.onToggleShortcuts}
					className="pointer-events-auto -mr-1 pointer-coarse:hidden"
				>
					?
				</Button>
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
	const identity = useAtomSuspense(identityAtom).value

	return (
		<>
			<div className="trail-grid pointer-events-none fixed inset-0 z-1 print:hidden" />
			<TrailGrid trails={portfolio.value.trails} viewport={input.viewport} />

			<OwnCursor
				viewport={input.viewport}
				color={pipe(
					portfolio.value.visitors,
					Array.findFirst(visitor => visitor.id === identity.id),
					Option.map(visitor => visitor.color)
				)}
			/>
			<div className="max-sm:hidden print:hidden">
				<div className="hidden [@media(hover:hover)_and_(pointer:fine)]:contents">
					{pipe(
						portfolio.value.visitors,
						Array.appendAll(portfolio.value.bots),
						Array.map(cursor =>
							Boolean.match(cursor.id === identity.id, {
								onFalse: () => <Cursor key={cursor.id} cursor={cursor} own={false} viewport={input.viewport} />,
								onTrue: () => null
							})
						)
					)}
				</div>
			</div>

			<PresenceHud
				presence={portfolio.value.visitors}
				onToggleShortcuts={input.onToggleShortcuts}
				shortcutsOpen={input.shortcutsOpen}
			/>
		</>
	)
}

// oxlint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- The portfolio is one keyboard-scrolling region; it needs focus and paging keys.
function PortfolioRoute() {
	const viewport = useAtomValue(viewportAtom)
	const setOwnCursor = useAtomSet(ownCursorAtom)
	useAtomMount(sendCursorAtom)
	const containerRef = useRef<HTMLDivElement>(null)
	const [showShortcuts, setShowShortcuts] = useState(false)

	function toggleShortcuts() {
		setShowShortcuts(show => !show)
	}

	function scrollTo(index: number) {
		const target = Array.fromIterable(containerRef.current?.querySelectorAll<HTMLElement>(':scope > section') ?? [])[
			index
		]
		if (Predicate.isUndefined(target)) return
		// A frequent keyboard jump lands at once.
		target.scrollIntoView({behavior: 'auto', block: 'start'})
	}

	function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
		// A swipe scrolls the page; only a hovering pointer paints a trail.
		if (event.pointerType === 'touch') return
		event.currentTarget.style.setProperty('--pointer-x', `${event.clientX}px`)
		event.currentTarget.style.setProperty('--pointer-y', `${event.clientY}px`)
		if (viewport.width === 0 || viewport.height === 0) return
		setOwnCursor(cursor => ({
			...cursor,
			x: Number.clamp(event.clientX / viewport.width, {maximum: 0.999999, minimum: 0}),
			y: Number.clamp(event.clientY / viewport.height, {maximum: 0.999999, minimum: 0})
		}))
	}

	useHotkeys([
		...Array.map(SECTION_KEYS, (hotkey, index) => ({
			callback: () => {
				scrollTo(index)
			},
			hotkey
		})),
		{callback: () => setOwnCursor(cursor => ({...cursor, color: pickNextCursorColor(cursor.color)})), hotkey: 'R'},
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
			tabIndex={0}
		>
			<ProfileSection />
			<SkillsSection />
			<ExperienceSection />
			<ProjectsSection />
			<EducationSection />
			<ContactSection />

			<CatchBoundary
				getResetKey={() => 'presence'}
				errorComponent={() => (
					<PresenceHud presence="offline" onToggleShortcuts={toggleShortcuts} shortcutsOpen={showShortcuts} />
				)}
			>
				<Suspense
					fallback={
						<>
							<OwnCursor viewport={viewport} color={Option.none()} />
							<PresenceHud presence="connecting" onToggleShortcuts={toggleShortcuts} shortcutsOpen={showShortcuts} />
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
