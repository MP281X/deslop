/* oxlint-disable shadcn/no-arbitrary-values -- The page's 0.15-0.35em letter-spacing sits beyond tracking-widest, and its 26px trail grid, the grid's line gradient, and the auto/1fr shortcut columns have no scale step. */
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
import {ArrowUpRight, Boxes, Database, FlaskConical, Monitor, MousePointer2, Server, Sparkles} from 'lucide-react'
import {Suspense, useEffect, useRef, useState, useSyncExternalStore} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@deslop/components-web/ui/dialog'
import {cn} from '@deslop/components-web/utils'

import {hasMeaningfulMove, portfolioPalette} from '#lib/portfolio.ts'
import {RpcClient} from '#lib/utils.ts'
import type {PortfolioVisitor, PortfolioVisitors} from '#services/presence/schema.ts'

const SECTION_KEYS = ['1', '2', '3', '4', '5', '6', '7'] as const

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

function pickNextCursorColor(currentColor: string) {
	const nextPalette = Array.filter(portfolioPalette, color => color !== currentColor)
	return nextPalette[randomIndex(Array.length(nextPalette))] ?? portfolioPalette[0]
}

function getIdentity() {
	const existingId = sessionStorage.getItem('portfolio.id')
	const existingName = sessionStorage.getItem('portfolio.name')
	const color = portfolioPalette[randomIndex(Array.length(portfolioPalette))] ?? portfolioPalette[0]

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

function subscribeToResize(onStoreChange: () => void) {
	addEventListener('resize', onStoreChange)
	return () => {
		removeEventListener('resize', onStoreChange)
	}
}

function Panel(input: {className?: string; children: React.ReactNode}) {
	return (
		<div className={cn('border-border/70 bg-background/88 border backdrop-blur-sm', input.className)}>
			{input.children}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: PortfolioRoute})

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
			<span className="bg-background text-foreground border border-(--cursor-color) px-1.5 py-1 font-mono text-xs whitespace-nowrap">
				{input.label}
			</span>
		</div>
	)
}

// Another visitor's cursor glides behind the page towards each position the server reports.
function VisitorCursor(input: {cursor: PortfolioVisitor; viewport: {width: number; height: number}}) {
	const nodeRef = useRef<HTMLDivElement>(null)
	const [initialMotion] = useState(() =>
		createCursorMotion(
			{x: input.cursor.x * input.viewport.width, y: input.cursor.y * input.viewport.height},
			input.viewport
		)
	)
	const motionRef = useRef(initialMotion)
	const animationFrameRef = useRef(0)

	useEffect(() => {
		motionRef.current = syncCursorMotion(motionRef.current, input.cursor, input.viewport)

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
			style={{
				'--cursor-color': input.cursor.color,
				'--cursor-transform': `translate3d(${initialMotion.x}px, ${initialMotion.y}px, 0)`
			}}
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
				'relative z-10 flex flex-col items-center overflow-hidden px-4 py-20 sm:px-6 sm:py-24',
				input.className
			)}
		>
			{input.children}
		</section>
	)
}

function SectionLabel(input: {title: string}) {
	return (
		<div className="mb-6 flex w-full max-w-5xl items-center gap-4 sm:mb-8">
			<div className="bg-primary/25 h-px flex-1" />
			<h2 className="border-primary/30 bg-background/88 text-primary border px-5 py-2 font-mono text-xs font-bold tracking-[0.35em] uppercase backdrop-blur-sm sm:text-sm">
				{input.title}
			</h2>
			<div className="bg-primary/25 h-px flex-1" />
		</div>
	)
}

function HeroSection() {
	return (
		<Section className="min-h-dvh justify-center py-16">
			<Panel className="flex w-full max-w-5xl flex-col items-center gap-6 p-8 sm:gap-8 sm:p-12">
				<div className="space-y-1 text-center">
					<h1 className="text-foreground font-mono text-4xl font-black tracking-[0.15em] uppercase sm:text-5xl md:text-6xl">
						Matteo
					</h1>
					<h2 className="text-foreground/50 font-mono text-2xl tracking-[0.25em] uppercase sm:text-3xl md:text-4xl">
						Paludgnach
					</h2>
				</div>

				<p className="text-foreground/70 text-center font-mono text-xs tracking-[0.25em] uppercase sm:text-sm sm:tracking-[0.3em]">
					Full-Stack TypeScript Developer
				</p>

				<div className="text-muted-foreground/60 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center font-mono text-xs">
					<span>Moimacco (UD), Italy</span>
					<span className="text-border/60">|</span>
					<span>React · TypeScript · Effect · Real-time</span>
				</div>
			</Panel>

			<div className="text-muted-foreground/35 absolute bottom-8 flex flex-col items-center gap-1">
				<span className="font-mono text-xs tracking-[0.3em] uppercase">scroll</span>
				<span className="text-sm">↓</span>
			</div>
		</Section>
	)
}

function AboutSection() {
	return (
		<Section>
			<SectionLabel title="About" />
			<div className="flex w-full max-w-5xl flex-col gap-4">
				<Panel className="p-5 sm:p-6">
					<div className="flex flex-col gap-4">
						{Array.map(
							[
								"I'm a full-stack TypeScript developer specializing in Effect, React, and AI agents, with experience building and shipping full-stack applications.",
								'Currently, I’m focusing on building stable, reusable primitives that coding agents can compose to build high-quality applications with minimal effort, while specialized skills, lint rules, and feedback loops steer the agent toward consistent patterns and rigorous review.'
							],
							line => (
								<p key={line} className="text-foreground/90 font-mono text-sm leading-7 sm:text-base">
									{line}
								</p>
							)
						)}
					</div>
				</Panel>
			</div>
		</Section>
	)
}

function SkillsSection() {
	return (
		<Section>
			<SectionLabel title="Skills" />
			<div className="grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
				{Array.map(
					[
						{area: 'Frontend', icon: Monitor, items: 'React, TypeScript, TanStack (Router, Table, Form), Tailwind CSS'},
						{area: 'Backend', icon: Server, items: 'Effect, Node.js, type-safe RPC, REST APIs'},
						{area: 'Data & Real-Time', icon: Database, items: 'PostgreSQL, Redis, WebSockets, SSE'},
						{area: 'DevOps', icon: Boxes, items: 'Docker, GitHub Actions, Git, Linux'},
						{area: 'Testing', icon: FlaskConical, items: 'Type-safe APIs, End-to-end testing, Unit testing'},
						{area: 'AI Tooling', icon: Sparkles, items: 'Codex, OpenCode, Github Copilot, Claude Code'}
					],
					skill => (
						<Panel key={skill.area} className="p-4 sm:p-5">
							<div className="mb-3 flex items-center gap-3">
								<skill.icon className="text-primary size-4" />
								<h3 className="text-foreground font-mono text-sm font-semibold tracking-[0.18em] uppercase">
									{skill.area}
								</h3>
							</div>
							<p className="text-muted-foreground font-mono text-xs leading-6 sm:text-sm">{skill.items}</p>
						</Panel>
					)
				)}
			</div>
		</Section>
	)
}

function ProjectCard(input: {
	project: {currentWork?: string; description: string; href: string; name: string; role: string; stack: string}
}) {
	return (
		<Panel className="flex h-full flex-col p-4 sm:p-5">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-foreground font-mono text-sm font-semibold tracking-widest uppercase">
						{input.project.name}
					</h3>
					<p className="text-muted-foreground mt-1 font-mono text-xs">{input.project.role}</p>
				</div>
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
			<p className="text-foreground/90 mt-4 font-mono text-xs leading-6 sm:text-sm">{input.project.description}</p>
			{Predicate.isNotUndefined(input.project.currentWork) && (
				<p className="text-muted-foreground mt-4 font-mono text-xs leading-5">
					<span className="text-foreground/80">Working on:</span> {input.project.currentWork}
				</p>
			)}
			<p className="text-muted-foreground/80 mt-auto pt-4 font-mono text-xs">{input.project.stack}</p>
		</Panel>
	)
}

function ProjectsSection() {
	return (
		<Section>
			<SectionLabel title="Personal Projects" />
			<div className="flex w-full max-w-5xl flex-col gap-4">
				<ProjectCard
					project={{
						currentWork:
							'An orchestration workflow that uses GPT-5.6 and Fable to plan with the user, then delegates implementation, testing, blind review, and publication to cheaper models, with self-improvement loops that learn from failures.',
						description:
							'A full-stack TypeScript monorepo that brings my applications, shared packages, and development tooling into one workspace.',
						href: 'https://github.com/MP281X/deslop',
						name: 'deslop',
						role: 'Full-Stack TypeScript Monorepo',
						stack: 'Effect · React · TypeScript · WebSockets · PostgreSQL · Docker'
					}}
				/>

				<div className="grid gap-4 md:grid-cols-2">
					{Array.map(
						[
							{
								description:
									'A starter for React and Kotlin/Spring applications with generated API types, PostgreSQL migrations, real-time sync, authentication, and reusable UI components.',
								href: 'https://github.com/MP281X/kotlin-react-template',
								name: 'Kotlin React Template',
								role: 'Full-Stack Starter',
								stack: 'React · Kotlin · Spring · Effect · PostgreSQL · ElectricSQL'
							},
							{
								description:
									'An open-source video platform with FFmpeg/HLS processing, background jobs, real-time upload progress, PostgreSQL, Redis, S3-compatible storage, and Kubernetes deployment.',
								href: 'https://github.com/MP281X/blixter_video',
								name: 'Blixter',
								role: 'Video Streaming Platform',
								stack: 'TypeScript · FFmpeg · PostgreSQL · Redis · Kubernetes'
							}
						],
						project => (
							<ProjectCard key={project.name} project={project} />
						)
					)}
				</div>
			</div>
		</Section>
	)
}

function ExperienceSection() {
	return (
		<Section>
			<SectionLabel title="Experience" />
			<div className="flex w-full max-w-5xl flex-col gap-4">
				{Array.map(
					[
						{
							company: 'Humans.Tech',
							highlights: [
								'Built the shared frontend foundation used to start new products, defining reusable architecture, tooling, and development conventions',
								'Developed reusable messaging interfaces for person-to-person and AI-agent conversations',
								'Created reusable data-display primitives, including tables and virtualized lists for large datasets',
								'Collaborated closely with backend engineers to design, integrate, and refine product functionality',
								'Introduced AI-assisted development workflows that accelerated implementation for both individual and team delivery'
							],
							location: 'Frosinone, Italy',
							note: '',
							period: 'Apr 2026 – Jul 2026',
							role: 'Frontend Developer'
						},
						{
							company: 'Tinexta Cyber',
							highlights: [
								'Developed a real-time network inventory application for a major telecommunications company',
								'Built the real-time frontend in React with ElectricSQL for live updates across all users',
								'Implemented a custom type-safe RPC-like client from the Kotlin backend OpenAPI schema',
								'Gathered requirements directly from end users and iterated through feedback rounds',
								'Containerized and deployed multiple services using Docker with Jenkins CI/CD',
								'Used AI coding agents daily with project-specific guidelines for development'
							],
							location: 'Udine, Italy',
							note: '',
							period: 'Oct 2024 – Mar 2026',
							role: 'Full-Stack Developer'
						},
						{
							company: 'Altitudo',
							highlights: [
								'Migrated the build system from Create React App to Vite',
								'Improved rendering performance by adding proper memoization',
								'Migrated legacy class components to modern functional components using React hooks',
								'Recreated and restyled multiple pages using React and Tailwind CSS'
							],
							location: 'Salzburg, Austria',
							note: 'Erasmus Internship',
							period: 'Jan 2024 – Mar 2024',
							role: 'Frontend Developer'
						},
						{
							company: 'BizAway',
							highlights: [
								'Developed a type-safe E2E testing framework on top of the OpenAPI schema using Playwright',
								'Built a type-safe email template framework using TSX-style components',
								'Migrated API endpoints from the old OpenAPI version to the new specification',
								'Built and updated multiple Angular components and features'
							],
							location: 'Spilimbergo, Italy',
							note: 'Internship',
							period: 'Jun 2023 – Aug 2023',
							role: 'Backend Developer'
						}
					],
					job => (
						<Panel key={job.company} className="px-4 py-4 sm:px-5">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
								<div className="space-y-1">
									<p className="text-foreground font-mono text-sm font-semibold tracking-widest uppercase">
										{job.company}
									</p>
									<div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs sm:text-sm">
										<span>{job.role}</span>
										{String.isNonEmpty(job.note) && <span className="text-muted-foreground/80">· {job.note}</span>}
									</div>
								</div>
								<p className="text-muted-foreground font-mono text-xs sm:text-right">
									{job.period} · {job.location}
								</p>
							</div>
							{Array.isReadonlyArrayNonEmpty(job.highlights) && (
								<ul className="mt-3 flex flex-col gap-1.5">
									{Array.map(job.highlights, highlight => (
										<li
											key={highlight}
											className="text-foreground/85 flex items-start gap-2 font-mono text-xs leading-6 sm:text-sm"
										>
											<span className="bg-foreground/50 mt-2 size-1 shrink-0 rounded-full" aria-hidden="true" />
											<span>{highlight}</span>
										</li>
									))}
								</ul>
							)}
						</Panel>
					)
				)}
			</div>
		</Section>
	)
}

function EducationSection() {
	return (
		<Section>
			<SectionLabel title="Education & Languages" />
			<div className="flex w-full max-w-5xl flex-col gap-4">
				{Array.map(
					[
						{
							degree: 'Cloud Developer Diploma',
							description:
								'Cloud-native architectures, CI/CD, Docker & Kubernetes, full-stack web application development.',
							grade: '95/100',
							period: '2022 – 2024',
							school: 'ITS Alto Adriatico'
						},
						{
							degree: 'High School Diploma – IT and Telecommunications',
							description: 'Telecommunications, electronics, networking fundamentals, and programming foundations.',
							grade: '',
							period: '2017 – 2022',
							school: 'ISIS A. Malignani'
						}
					],
					entry => (
						<Panel key={entry.school} className="px-4 py-4 sm:px-5">
							<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
								<div className="flex flex-wrap items-baseline gap-x-3">
									<span className="text-foreground font-mono text-sm font-semibold">{entry.school}</span>
									<span className="text-muted-foreground font-mono text-xs sm:text-sm">{entry.degree}</span>
									{String.isNonEmpty(entry.grade) && (
										<span className="text-muted-foreground/80 font-mono text-xs">({entry.grade})</span>
									)}
								</div>
								<span className="text-muted-foreground/80 font-mono text-xs">{entry.period}</span>
							</div>
							<p className="text-foreground/85 mt-2 font-mono text-xs leading-6 sm:text-sm">{entry.description}</p>
						</Panel>
					)
				)}
				<div className="grid gap-3 sm:grid-cols-3">
					{Array.map(
						[
							{language: 'Italian', level: 'Native'},
							{language: 'English', level: 'C1'},
							{language: 'Spanish', level: 'Basic'}
						],
						lang => (
							<Panel key={lang.language} className="px-4 py-3">
								<span className="text-foreground font-mono text-xs font-semibold">{lang.language}</span>
								<span className="text-muted-foreground/80 ml-2 font-mono text-xs">{lang.level}</span>
							</Panel>
						)
					)}
				</div>
			</div>
		</Section>
	)
}

function ContactSection() {
	return (
		<Section>
			<SectionLabel title="Contact" />
			<div className="flex w-full max-w-5xl flex-col gap-3">
				{Array.map(
					[
						{href: 'mailto:paludgnachmatteo.dev@gmail.com', label: 'Email', value: 'paludgnachmatteo.dev@gmail.com'},
						{href: 'tel:+393518853376', label: 'Phone', value: '+39 351 885 3376'},
						{href: 'https://github.com/MP281X', label: 'GitHub', value: 'github.com/MP281X'}
					],
					item => (
						<a
							key={item.label}
							href={item.href}
							className="border-border/70 bg-background/90 hover:border-primary/50 hover:text-primary flex flex-col gap-2 border p-4 font-mono text-xs backdrop-blur-sm transition-colors sm:flex-row sm:items-center sm:justify-between sm:text-sm"
							target="_blank"
							rel="noopener noreferrer"
						>
							<span className="text-muted-foreground text-xs tracking-[0.15em] uppercase">{item.label}</span>
							<span className="text-foreground break-all">{item.value}</span>
						</a>
					)
				)}
			</div>
			<p className="text-muted-foreground/70 mt-6 font-mono text-xs">© 2026 Matteo Paludgnach · Moimacco (UD), Italy</p>
		</Section>
	)
}

function ShortcutsOverlay(input: {open: boolean; onOpenChange: (open: boolean) => void}) {
	return (
		<Dialog open={input.open} onOpenChange={input.onOpenChange}>
			<DialogContent className="border-border/70 bg-background p-6 font-mono sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-foreground font-mono text-sm tracking-[0.2em] uppercase">
						Keyboard Shortcuts
					</DialogTitle>
				</DialogHeader>
				<div className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-xs sm:gap-x-8">
					<span className="text-foreground">j / k</span>
					<span>next / prev section</span>
					<span className="text-foreground">1 – 7</span>
					<span>jump to section</span>
					<span className="text-foreground">r</span>
					<span>change cursor color</span>
					<span className="text-foreground">?</span>
					<span>toggle this overlay</span>
					<span className="text-foreground">Esc</span>
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
			{/* oxlint-disable-next-line @deslop/coding-standards/no-gradient -- hard color stops draw the 1px trail grid's lines; nothing fades */}
			<div className="pointer-events-none fixed inset-0 z-1 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--color-foreground)_3%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--color-foreground)_3%,transparent)_1px,transparent_1px)] bg-size-[26px_26px]" />
			<TrailCanvas trails={portfolio.value.trails} viewport={input.viewport} />

			{Array.map(portfolio.value.visitors, cursor => {
				if (cursor.id === identity.id) return <OwnCursor key={cursor.id} cursor={cursor} viewport={input.viewport} />
				return <VisitorCursor key={cursor.id} cursor={cursor} viewport={input.viewport} />
			})}

			<div className="border-border/70 bg-background/95 pointer-events-none fixed bottom-3 left-3 z-50 flex items-center gap-2 border px-3 py-2 font-mono text-xs backdrop-blur-sm sm:bottom-4 sm:left-4">
				<span
					className="size-2 bg-(--identity-color)"
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
	const colorRef = useRef<string>(identity.color)
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

	// At most one move per 50 ms, carrying the latest pointer position.
	function flushPointer() {
		pointerFrameRef.current = 0
		if (pointerRef.current === null) return
		if (lastSentPointerRef.current !== null) {
			if (!hasMeaningfulMove(lastSentPointerRef.current, pointerRef.current)) return
			if (performance.now() - lastSentPointerRef.current.sentAt < 50) {
				pointerFrameRef.current = requestAnimationFrame(flushPointer)
				return
			}
		}
		send(pointerRef.current)
	}

	function updatePointer(event: React.PointerEvent<HTMLDivElement>) {
		event.currentTarget.style.setProperty('--pointer-x', `${event.clientX}px`)
		event.currentTarget.style.setProperty('--pointer-y', `${event.clientY}px`)
		if (viewport.width === 0 || viewport.height === 0) return

		pointerRef.current = {
			x: Number.clamp({maximum: 0.999_999, minimum: 0})(event.clientX / viewport.width),
			y: Number.clamp({maximum: 0.999_999, minimum: 0})(event.clientY / viewport.height)
		}
		if (pointerFrameRef.current === 0) pointerFrameRef.current = requestAnimationFrame(flushPointer)
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
			<AboutSection />
			<SkillsSection />
			<ProjectsSection />
			<ExperienceSection />
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
