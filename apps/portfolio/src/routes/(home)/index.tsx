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

import {ArrowUpRightIcon, CursorIcon} from '@phosphor-icons/react'
import {useHotkeys} from '@tanstack/react-hotkeys'
import {CatchBoundary, createFileRoute} from '@tanstack/react-router'
import {Atom} from 'effect/reactivity'
import {Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Kbd, KbdGroup} from '@deslop/components-web/ui/kbd'
import {cn} from '@deslop/components-web/utils'

import {hasMeaningfulMove} from '#lib/portfolio.ts'
import {contacts, education, experience, languages, profile, projects, skills, summary} from '#lib/profile.ts'
import {RpcClient} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import {PortfolioColor} from '#services/presence/schema.ts'
import type {PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6'] as const
const SECTION_NAMES = ['profile', 'expertise', 'experience', 'projects', 'education', 'contact'] as const
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
					const positions = HashSet.fromIterable(
						Array.map(scene.visitors, visitor => Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y))
					)
					// The latest 180 positions in the order visitors reached them; a recolour starts a new stretch where the cursor is.
					const next = {
						trails: Array.takeRight(
							Array.appendAll(
								scene.trails,
								Array.filter(
									visitors,
									visitor => !HashSet.has(positions, Tuple.make(visitor.id, visitor.color, visitor.x, visitor.y))
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
	// Reduced motion keeps the colour and drops the glide, as every other transition on the page does.
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

	return {
		...motion,
		lastFrameAt: now,
		x: Boolean.match(reduced, {
			onFalse: () => approach({catchUp, maximum: motion.viewportWidth, position: motion.x, target: motion.targetX}),
			onTrue: () => motion.targetX
		}),
		y: Boolean.match(reduced, {
			onFalse: () => approach({catchUp, maximum: motion.viewportHeight, position: motion.y, target: motion.targetY}),
			onTrue: () => motion.targetY
		})
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

// A ruled label names each part of the page; its number and note stay in mono, the label itself a tracked sans.
function SectionLabel(input: {id: string; label: string; meta?: React.ReactNode; number: string}) {
	return (
		<div className="border-border flex items-center justify-between gap-4 border-t pt-3 pb-5">
			<div className="flex items-baseline gap-3">
				<span aria-hidden className="text-muted-foreground font-mono text-xs tabular-nums">
					{input.number}
				</span>
				<h2 id={input.id} className="tracking-label text-xs font-semibold uppercase">
					{input.label}
				</h2>
			</div>
			{Predicate.isNotUndefined(input.meta) && (
				<span className="text-muted-foreground text-right font-mono text-xs tabular-nums">{input.meta}</span>
			)}
		</div>
	)
}

// One opaque reading column over the live grid: every section carries the paper, so trails never run under a line.
function RuledSection(input: {
	children: React.ReactNode
	className?: string
	id: string
	label: string
	meta?: string
	number: string
}) {
	return (
		<section
			aria-labelledby={input.id}
			className={cn('relative z-10 mx-auto w-full max-w-3xl px-6 select-text sm:px-8', input.className)}
		>
			<div className="bg-background">
				<SectionLabel id={input.id} label={input.label} meta={input.meta} number={input.number} />
				{input.children}
			</div>
		</section>
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

// The pointer stays, the name only where it would not sit over the page's reading column.
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

// The name is a small mono chip; its width matters when it sits just outside the reading column.
function labelWidth(label: string) {
	return label.length * 8 + 28
}

// Whether a cursor's label would sit over the centered reading column, where it would cover the text.
function overContent(x: number, viewport: {width: number}, label: string) {
	const at = x * viewport.width
	const width = labelWidth(label)
	const left = (viewport.width - 768) / 2
	const right = (viewport.width + 768) / 2
	if (at < left) return at + width > left
	return at <= right || at - width < right
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
			<CursorLabel
				flip={input.cursor.x * input.viewport.width + labelWidth(input.cursor.name) > input.viewport.width - 8}
				label={input.cursor.name}
				show={!overContent(input.cursor.x, input.viewport, input.cursor.name)}
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
				show={!overContent(input.cursor.x, input.viewport, 'You')}
			/>
		</div>
	)
}

// A header action is a link first: the value, a hairline underline, and a 44px row on a phone.
function HeaderLink(input: {children: React.ReactNode; external?: boolean; href: string}) {
	const external = input.external === true
	return (
		<a
			href={input.href}
			target={Boolean.match(external, {onFalse: () => undefined, onTrue: () => '_blank' as const})}
			rel={Boolean.match(external, {onFalse: () => undefined, onTrue: () => 'noopener noreferrer' as const})}
			className="text-foreground decoration-border hover:text-primary hover:decoration-primary inline-flex h-11 min-w-11 items-center gap-1.5 text-sm underline underline-offset-4 transition-colors sm:h-auto sm:pb-0.5"
		>
			{input.children}
			{external && <ArrowUpRightIcon className="size-3.5" />}
		</a>
	)
}

// The masthead is the first ruled section: role and place set the stage, the name is the one display statement.
function ProfileSection() {
	return (
		<section
			aria-labelledby="profile-title"
			className="relative z-10 mx-auto w-full max-w-3xl px-6 pt-10 pb-12 select-text sm:px-8 sm:pt-16 sm:pb-16"
		>
			<div className="bg-background">
				<div className="border-border flex items-center justify-between gap-4 border-t pt-3 pb-10 sm:pb-14">
					<div className="flex items-baseline gap-3">
						<span aria-hidden className="text-muted-foreground font-mono text-xs tabular-nums">
							01
						</span>
						<p className="tracking-label text-xs font-semibold uppercase">Profile</p>
					</div>
					<img alt="" className="pixelated size-6 shrink-0 opacity-90 sm:size-7" src={icon} />
				</div>

				<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
					<p className="text-sm font-medium">{profile.title}</p>
					<p className="text-muted-foreground font-mono text-xs">{profile.location}</p>
				</div>

				<h1
					id="profile-title"
					className="font-heading mt-4 text-5xl leading-none tracking-tight text-balance sm:text-7xl"
				>
					{profile.firstName} {profile.lastName}
				</h1>

				<p className="text-muted-foreground mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
					{summary}
				</p>

				<div className="mt-8 flex flex-col items-start sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7">
					<HeaderLink href="#section-projects">Selected work</HeaderLink>
					<HeaderLink href={contacts.email.href}>{contacts.email.value}</HeaderLink>
					<HeaderLink external href={contacts.github.href}>
						{contacts.github.value}
					</HeaderLink>
					<HeaderLink href="/cv">CV</HeaderLink>
				</div>
			</div>
		</section>
	)
}

function SkillsSection() {
	return (
		<RuledSection
			className="pb-12 sm:pb-14"
			id="section-skills"
			label="Expertise"
			meta={`${Array.length(skills)} disciplines`}
			number="04"
		>
			<dl className="divide-border flex flex-col divide-y">
				{Array.map(skills, skill => (
					<div key={skill.area} className="flex flex-col gap-1 py-3.5 sm:flex-row sm:gap-8">
						<dt className="tracking-label text-muted-foreground w-36 shrink-0 text-xs font-semibold uppercase">
							{skill.area}
						</dt>
						<dd className="text-foreground/90 text-sm leading-relaxed">{skill.items}</dd>
					</div>
				))}
				<div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:gap-8">
					<dt className="tracking-label text-muted-foreground w-36 shrink-0 text-xs font-semibold uppercase">
						Languages
					</dt>
					<dd className="text-foreground/90 text-sm leading-relaxed">
						{pipe(
							languages,
							Array.map(entry => `${entry.language} (${entry.level})`),
							Array.join(' · ')
						)}
					</dd>
				</div>
			</dl>
		</RuledSection>
	)
}

function ProjectsSection() {
	return (
		<RuledSection
			className="pb-12 sm:pb-14"
			id="section-projects"
			label="Selected work"
			meta={`${Array.length(projects)} selected`}
			number="02"
		>
			<ol className="divide-border flex flex-col divide-y">
				{Array.map(projects, project => (
					<li key={project.name} className="py-5">
						<div className="flex items-baseline justify-between gap-4">
							<h3 className="text-base font-semibold tracking-tight">{project.name}</h3>
							<a
								href={project.href}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`View ${project.name} on GitHub`}
								className="text-muted-foreground hover:text-primary tracking-label -mr-2 inline-flex h-11 items-center gap-1 px-2 text-xs font-semibold uppercase transition-colors sm:h-auto sm:py-0"
							>
								GitHub
								<ArrowUpRightIcon className="size-3.5" />
							</a>
						</div>
						<p className="text-muted-foreground mt-0.5 text-sm">{project.role}</p>
						<p className="text-foreground/90 mt-2 text-sm leading-relaxed">{project.description}</p>
						<p className="text-muted-foreground mt-2 font-mono text-xs">{project.stack}</p>
					</li>
				))}
			</ol>
		</RuledSection>
	)
}

function ExperienceSection() {
	return (
		<RuledSection
			className="pb-12 sm:pb-14"
			id="section-experience"
			label="Experience"
			meta={`${Array.length(experience)} roles`}
			number="03"
		>
			<ol className="divide-border flex flex-col divide-y">
				{Array.map(experience, job => (
					<li key={job.company} className="flex flex-col gap-2 py-5 sm:flex-row sm:gap-8">
						<div className="text-muted-foreground flex flex-row flex-wrap items-baseline gap-x-2 font-mono text-xs sm:w-40 sm:shrink-0 sm:flex-col sm:items-start sm:gap-1">
							<p className="whitespace-nowrap tabular-nums">{job.period}</p>
							{Predicate.isNotUndefined(job.location) && (
								<>
									<span aria-hidden className="sm:hidden">
										·
									</span>
									<p className="whitespace-nowrap">{job.location}</p>
								</>
							)}
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<div>
								<h3 className="text-sm font-semibold tracking-tight">{job.company}</h3>
								<p className="text-muted-foreground text-sm">
									{job.role}
									{Predicate.isNotUndefined(job.note) && <span className="italic"> · {job.note}</span>}
								</p>
							</div>
							<ul className="flex flex-col gap-1.5">
								{Array.map(job.highlights, highlight => (
									<li key={highlight} className="text-foreground/90 flex gap-3 text-sm leading-relaxed">
										<span aria-hidden className="bg-muted-foreground/60 mt-2.5 h-px w-3 shrink-0" />
										<span>{highlight}</span>
									</li>
								))}
							</ul>
						</div>
					</li>
				))}
			</ol>
		</RuledSection>
	)
}

function EducationSection() {
	return (
		<RuledSection className="pb-12 sm:pb-14" id="section-education" label="Education" number="05">
			<ol className="divide-border flex flex-col divide-y">
				{Array.map(education, entry => (
					<li key={entry.school} className="flex flex-col gap-1.5 py-5 sm:flex-row sm:gap-8">
						<p className="text-muted-foreground font-mono text-xs whitespace-nowrap tabular-nums sm:w-40 sm:shrink-0">
							{entry.period}
						</p>
						<div>
							<h3 className="text-sm font-semibold tracking-tight">{entry.degree}</h3>
							<p className="text-muted-foreground mt-0.5 text-sm">
								{entry.school}
								{Predicate.isNotUndefined(entry.grade) && (
									<>
										{' · '}
										<span className="font-mono text-xs tabular-nums">{entry.grade}</span>
									</>
								)}
							</p>
						</div>
					</li>
				))}
			</ol>
		</RuledSection>
	)
}

function ContactSection() {
	const links = [
		contacts.email,
		contacts.pec,
		contacts.phone,
		contacts.github,
		{href: '/cv', label: 'CV', value: `${profile.portfolio}/cv`}
	]
	return (
		<RuledSection
			className="pb-24 sm:pb-28"
			id="section-contact"
			label="Contact"
			meta={`${Array.length(links)} ways`}
			number="06"
		>
			<div className="flex flex-col">
				{Array.map(links, item => {
					const external = String.startsWith('http')(item.href)
					return (
						<a
							key={item.label}
							href={item.href}
							className="group border-border hover:text-primary flex min-h-11 items-center justify-between gap-6 border-b py-2.5 text-sm transition-colors last:border-b-0"
							target={Boolean.match(external, {onFalse: () => undefined, onTrue: () => '_blank' as const})}
							rel={Boolean.match(external, {onFalse: () => undefined, onTrue: () => 'noopener noreferrer' as const})}
						>
							<span className="tracking-label text-muted-foreground group-hover:text-primary text-xs font-semibold uppercase">
								{item.label}
							</span>
							<span className="group-hover:text-primary text-right font-mono text-xs break-all">{item.value}</span>
						</a>
					)
				})}
			</div>
			<p className="text-muted-foreground mt-10 font-mono text-xs">
				© 2026 {profile.firstName} {profile.lastName} · VAT {profile.vat}
			</p>
		</RuledSection>
	)
}

// The shortcut legend is a printed card, not an app dialog: ruled rows and the page's own mono keys.
function ShortcutRow(input: {keys: React.ReactNode; label: React.ReactNode}) {
	return (
		<div className="flex items-center justify-between gap-6 py-3">
			<span className="text-sm">{input.label}</span>
			{input.keys}
		</div>
	)
}

function ShortcutsOverlay(input: {open: boolean; onOpenChange: (open: boolean) => void}) {
	return (
		<Dialog open={input.open} onOpenChange={input.onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Keyboard</DialogTitle>
					<DialogDescription>The page moves without a mouse.</DialogDescription>
				</DialogHeader>
				<div className="divide-border flex flex-col divide-y">
					<ShortcutRow
						keys={
							<KbdGroup>
								<Kbd>j</Kbd>
								<Kbd>k</Kbd>
							</KbdGroup>
						}
						label="Next / previous section"
					/>
					<ShortcutRow
						keys={
							<KbdGroup>
								<Kbd>1</Kbd>–<Kbd>6</Kbd>
							</KbdGroup>
						}
						label={
							<span className="flex flex-col gap-1">
								Jump to a section
								<span className="text-muted-foreground font-mono text-xs">
									{pipe(
										Array.map(SECTION_NAMES, (name, index) => `${index + 1} ${name}`),
										Array.join(' · ')
									)}
								</span>
							</span>
						}
					/>
					<ShortcutRow keys={<Kbd>r</Kbd>} label="Change cursor color" />
					<ShortcutRow keys={<Kbd>?</Kbd>} label="Toggle this panel" />
					<ShortcutRow keys={<Kbd>Esc</Kbd>} label="Close this panel" />
				</div>
			</DialogContent>
		</Dialog>
	)
}

// The live count, its dot in the local cursor's color; the fixed HUD adds the shortcut hint.
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

// Presence is a quiet line at the page's edge: live count, connecting, or unavailable, never a hero.
function PresenceHud(input: {state: 'connecting' | 'live' | 'offline'; visitors?: PortfolioVisitors}) {
	return (
		<div className="border-border bg-background/95 pb-safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-50 flex min-h-10 items-center justify-between border-t px-3 font-mono text-xs backdrop-blur sm:px-4 print:hidden">
			<span className="flex items-center gap-2">
				{Boolean.match(input.state === 'live' && Predicate.isNotUndefined(input.visitors), {
					onFalse: () => (
						<>
							<span className="bg-muted-foreground/50 size-1.5 rounded-full" />
							<span className="text-muted-foreground">
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
			<span className="text-muted-foreground max-sm:hidden">j/k · ?</span>
		</div>
	)
}

function RealtimeLayer(input: {viewport: {width: number; height: number}}) {
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
					{Array.map(portfolio.value.visitors, cursor =>
						Boolean.match(cursor.id === identity.id, {
							onFalse: () => <VisitorCursor key={cursor.id} cursor={cursor} viewport={input.viewport} />,
							onTrue: () => null
						})
					)}
				</div>
			</div>

			<PresenceHud state="live" visitors={portfolio.value.visitors} />
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
			aria-label="Portfolio"
			role="region"
			className="focus-visible:ring-border relative min-h-0 flex-1 overflow-x-hidden overflow-y-scroll focus-visible:ring-1 focus-visible:ring-inset print:h-auto print:overflow-visible [@media(hover:hover)_and_(pointer:fine)]:cursor-none"
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
			<ProjectsSection />
			<ExperienceSection />
			<SkillsSection />
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
							<PresenceHud state="connecting" />
						</>
					}
				>
					<RealtimeLayer viewport={viewport} />
				</Suspense>
			</CatchBoundary>

			<Button
				variant="outline"
				size="icon"
				aria-expanded={showShortcuts}
				aria-haspopup="dialog"
				aria-label="Toggle keyboard shortcuts"
				onClick={() => {
					setShowShortcuts(show => !show)
				}}
				className="mb-safe-bottom mr-safe-right fixed right-3 bottom-14 z-50 max-sm:hidden sm:right-4 print:hidden"
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
