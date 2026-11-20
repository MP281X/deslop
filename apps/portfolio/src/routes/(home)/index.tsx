import {useAtomMount, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Match, Number, Predicate, Schema, String, pipe} from 'effect'

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
import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useRef, useState} from 'react'

import {cn} from '@deslop/components-web/lib/utils'
import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Kbd, KbdGroup} from '@deslop/components-web/ui/kbd'

import {ownColorAtom, ownCursorAtom, recolorAtom, sceneAtom, sendCursorAtom} from '#lib/presence.ts'
import {contacts, education, experience, languages, profile, projects, skills, summary} from '#lib/profile.ts'
import {trailCells} from '#lib/trails.ts'
import {VisitorId, Visitors} from '#services/presence/schema.ts'
import type {Visitor} from '#services/presence/schema.ts'

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6'] as const
const SECTION_NAMES = ['profile', 'skills', 'experience', 'projects', 'education', 'contact'] as const

type PresenceState = typeof PresenceState.Type
const PresenceState = Schema.TaggedUnion({Connecting: {}, Offline: {}, Visitors: {visitors: Visitors}})

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
	return (
		<svg
			aria-hidden
			className="pointer-events-none fixed inset-0 z-1 size-full print:hidden"
			shapeRendering="crispEdges"
		>
			{Array.map(trailCells(input.trails, input.viewport), cell => (
				<rect key={cell.key} x={cell.x} y={cell.y} width={24} height={24} fill={cell.fill} fillOpacity={cell.opacity} />
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
				onTrue: Function.constNull
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
	const label = Boolean.match(input.own, {onFalse: () => input.cursor.name, onTrue: Function.constant('You')})
	const x = `${input.cursor.x * input.viewport.width}px`
	const y = `${input.cursor.y * input.viewport.height}px`
	return (
		<div
			aria-hidden
			className={cn(
				'pointer-events-none fixed top-0 left-0 transform-(--cursor-transform)',
				Boolean.match(input.own, {onFalse: Function.constant('z-5'), onTrue: Function.constant('z-20')})
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

// Drawn whatever presence does, since the page hides the system pointer for it.
function OwnCursor(input: {viewport: {width: number; height: number}}) {
	return (
		<div className="mouse:contents hidden print:hidden">
			<Cursor
				own
				cursor={{
					...useAtomValue(ownCursorAtom),
					color: useAtomValue(ownColorAtom),
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
								target={Boolean.match(internal, {
									onFalse: Function.constant('_blank' as const),
									onTrue: Function.constUndefined
								})}
								rel={Boolean.match(internal, {
									onFalse: Function.constant('noopener noreferrer' as const),
									onTrue: Function.constUndefined
								})}
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
	return (
		<>
			<span
				className="size-1.5 rounded-full bg-(--identity-color)"
				style={{'--identity-color': useAtomValue(ownColorAtom)}}
			/>
			<span className="text-foreground tabular-nums">{Array.length(props.visitors)}</span>
			<span className="text-muted-foreground">
				{Boolean.match(Array.length(props.visitors) === 1, {
					onFalse: Function.constant('visitors'),
					onTrue: Function.constant('visitor')
				})}
			</span>
		</>
	)
}

// Italian law asks a VAT holder's website to show the number on its home page.
const LEGAL_LINE = `© 2026 ${profile.firstName} ${profile.lastName} · VAT ${profile.vat}`
const LEGAL_LINE_NARROW = `© 2026 · VAT ${profile.vat}`

function PresenceHud(input: {presence: PresenceState; onToggleShortcuts: () => void; shortcutsOpen: boolean}) {
	return (
		<div className="border-border bg-background/95 pr-safe-right pb-safe-bottom pl-safe-left pointer-events-none fixed inset-x-0 bottom-0 z-50 border-t font-mono text-xs backdrop-blur print:hidden">
			<div className="relative flex min-h-10 items-center justify-between px-3 sm:px-4">
				<span className="flex min-w-0 items-center gap-2">
					{pipe(
						Match.value(input.presence),
						Match.tag('Visitors', state => <VisitorCount visitors={state.visitors} />),
						Match.orElse(state => (
							<>
								<span className="bg-muted-foreground/50 size-1.5 rounded-full" />
								<span className="text-muted-foreground truncate">
									{Boolean.match(PresenceState.isAnyOf(['Offline'])(state), {
										onFalse: Function.constant('presence connecting'),
										onTrue: Function.constant('presence unavailable')
									})}
								</span>
							</>
						))
					)}
				</span>
				<span className="text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap max-sm:static max-sm:translate-x-0 max-sm:translate-y-0 pointer-coarse:static pointer-coarse:translate-x-0 pointer-coarse:translate-y-0">
					<span className="hidden sm:inline">{LEGAL_LINE}</span>
					<span className="sm:hidden">{LEGAL_LINE_NARROW}</span>
				</span>
				<span className="pointer-events-auto flex pointer-coarse:hidden">
					<Button
						variant="ghost"
						size="xs"
						aria-expanded={input.shortcutsOpen}
						aria-haspopup="dialog"
						aria-label="Toggle keyboard shortcuts"
						onClick={input.onToggleShortcuts}
					>
						?
					</Button>
				</span>
			</div>
		</div>
	)
}

// The room while it answers; before its first scene and through an outage, only the HUD saying so, never a stale room.
function PresenceLayer(input: {
	viewport: {width: number; height: number}
	onToggleShortcuts: () => void
	shortcutsOpen: boolean
}) {
	function hud(presence: PresenceState) {
		return (
			<PresenceHud
				presence={presence}
				onToggleShortcuts={input.onToggleShortcuts}
				shortcutsOpen={input.shortcutsOpen}
			/>
		)
	}

	return AsyncResult.match(useAtomValue(sceneAtom), {
		onFailure: () => hud(PresenceState.cases.Offline.make({})),
		onInitial: () => hud(PresenceState.cases.Connecting.make({})),
		onSuccess: scene => (
			<>
				<div className="trail-grid pointer-events-none fixed inset-0 z-1 print:hidden" />
				<TrailGrid trails={scene.value.trails} viewport={input.viewport} />

				<div className="max-sm:hidden print:hidden">
					<div className="mouse:contents hidden">
						{pipe(
							scene.value.visitors,
							Array.appendAll(scene.value.bots),
							Array.map(cursor =>
								Boolean.match(cursor.id === scene.value.own, {
									onFalse: () => <Cursor key={cursor.id} cursor={cursor} own={false} viewport={input.viewport} />,
									onTrue: Function.constNull
								})
							)
						)}
					</div>
				</div>

				{hud(PresenceState.cases.Visitors.make({visitors: scene.value.visitors}))}
			</>
		)
	})
}

// Early input lacks a DOM ref or viewport; presence reports Offline instead of substituting a successful scene.
function PortfolioRoute() {
	const viewport = useAtomValue(viewportAtom)
	const setOwnCursor = useAtomSet(ownCursorAtom)
	const recolor = useAtomSet(recolorAtom)
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
		setOwnCursor({
			x: Number.clamp(event.clientX / viewport.width, {maximum: 0.999999, minimum: 0}),
			y: Number.clamp(event.clientY / viewport.height, {maximum: 0.999999, minimum: 0})
		})
	}

	useHotkeys([
		...Array.map(SECTION_KEYS, (hotkey, index) => ({
			callback: () => {
				scrollTo(index)
			},
			hotkey
		})),
		{callback: () => recolor(), hotkey: 'R'},
		{callback: toggleShortcuts, hotkey: {key: '?', shift: true}}
	])

	return (
		<div
			ref={containerRef}
			aria-label="Portfolio"
			role="region"
			className="portfolio-page focus-visible:ring-border mouse:cursor-none relative min-h-0 flex-1 overflow-x-hidden overflow-y-scroll overscroll-contain focus-visible:ring-1 focus-visible:ring-inset print:h-auto print:overflow-visible"
			onPointerMove={updatePointer}
			tabIndex={0}
		>
			<ProfileSection />
			<SkillsSection />
			<ExperienceSection />
			<ProjectsSection />
			<EducationSection />
			<ContactSection />

			<OwnCursor viewport={viewport} />
			<PresenceLayer viewport={viewport} onToggleShortcuts={toggleShortcuts} shortcutsOpen={showShortcuts} />

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
