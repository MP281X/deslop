import {Array, Boolean, Number, Predicate, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {ArrowUpRight, Boxes, Database, FlaskConical, Monitor, Server, Sparkles} from 'lucide-react'
import {useState} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {cn} from '@deslop/components-web/utils'

import {
	type Part,
	type Shade,
	type Tone,
	assemblyAt,
	gapAt,
	project,
	stackOf,
	viewOf,
	visibleFaces
} from '#lib/figure3d.ts'

const PROJECTS = [
	{
		currentWork:
			'An orchestration workflow that uses GPT-5.6 and Fable to plan with the user, then delegates implementation, testing, blind review, and publication to cheaper models, with self-improvement loops that learn from failures.',
		description:
			'A full-stack TypeScript monorepo that brings my applications, shared packages, and development tooling into one workspace.',
		href: 'https://github.com/MP281X/deslop',
		name: 'deslop',
		role: 'Full-Stack TypeScript Monorepo',
		stack: 'Effect · React · TypeScript · WebSockets · PostgreSQL · Docker'
	},
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
]

const EXPERIENCE = [
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
]

const EDUCATION = [
	{
		degree: 'Cloud Developer Diploma',
		description: 'Cloud-native architectures, CI/CD, Docker & Kubernetes, full-stack web application development.',
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
]

const LANGUAGES = [
	{language: 'Italian', level: 'Native'},
	{language: 'English', level: 'C1'},
	{language: 'Spanish', level: 'Basic'}
]

const CONTACT = [
	{href: 'mailto:paludgnachmatteo.dev@gmail.com', label: 'Email', value: 'paludgnachmatteo.dev@gmail.com'},
	{href: 'tel:+393518853376', label: 'Phone', value: '+39 351 885 3376'},
	{href: 'https://github.com/MP281X', label: 'GitHub', value: 'github.com/MP281X'}
]

const ABOUT = [
	"I'm a full-stack TypeScript developer specializing in Effect, React, and AI agents, with experience building and shipping full-stack applications.",
	'Currently, I’m focusing on building stable, reusable primitives that coding agents can compose to build high-quality applications with minimal effort, while specialized skills, lint rules, and feedback loops steer the agent toward consistent patterns and rigorous review.'
]

// Icons are not literals, so this block stays below the literal constants above.
const SKILLS = [
	{area: 'Frontend', icon: Monitor, items: 'React, TypeScript, TanStack (Router, Table, Form), Tailwind CSS'},
	{area: 'Backend', icon: Server, items: 'Effect, Node.js, type-safe RPC, REST APIs'},
	{area: 'Data & Real-Time', icon: Database, items: 'PostgreSQL, Redis, WebSockets, SSE'},
	{area: 'DevOps', icon: Boxes, items: 'Docker, GitHub Actions, Git, Linux'},
	{area: 'Testing', icon: FlaskConical, items: 'Type-safe APIs, End-to-end testing, Unit testing'},
	{area: 'AI Tooling', icon: Sparkles, items: 'Codex, OpenCode, Github Copilot, Claude Code'}
]

const VIEW = viewOf(stackOf(gapAt(0)), 14)

function ink(percent: number) {
	return `color-mix(in oklch, var(--foreground) ${percent}%, var(--background))`
}

function accent(percent: number) {
	return `color-mix(in oklch, var(--primary) ${percent}%, var(--background))`
}

const TONE: Record<Tone | 'lit', Record<Shade, string>> = {
	base: {left: ink(40), right: ink(28), top: ink(18)},
	lit: {left: accent(62), right: accent(80), top: accent(100)},
	paper: {left: ink(16), right: ink(8), top: ink(0)},
	post: {left: ink(30), right: ink(20), top: ink(12)}
}

function PartShape(input: {part: Part; selected: number}) {
	const paint = Boolean.match(input.part.plate === input.selected, {
		onFalse: () => input.part.tone,
		onTrue: () => 'lit' as const
	})

	return (
		<g>
			{Array.map(visibleFaces(input.part.box), face => (
				<polygon
					key={face.shade}
					points={face.points}
					fill={TONE[paint][face.shade]}
					stroke="var(--foreground)"
					strokeOpacity={0.25}
					strokeWidth={1}
					vectorEffect="non-scaling-stroke"
					strokeLinejoin="round"
					className="transition-colors duration-200 ease-out"
				/>
			))}
			{Array.map(input.part.screws, (screw, index) => {
				const point = project(screw)
				return <circle key={index} cx={point.x} cy={point.y} r={1.8} fill="var(--foreground)" opacity={0.5} />
			})}
		</g>
	)
}

function Figure(input: {assembly: number; className: string; selected: number}) {
	const parts = stackOf(gapAt(input.assembly))

	return (
		<svg
			viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
			role="img"
			aria-label={`Six skill plates, ${Number.round(input.assembly * 100, 0)}% assembled`}
			className={input.className}
		>
			{Array.map(parts, (part, index) => (
				<PartShape key={index} part={part} selected={input.selected} />
			))}
		</svg>
	)
}

function Row(input: {children: React.ReactNode; label: string}) {
	return (
		<section className="border-border grid gap-6 border-t px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-12">
			<h2 className="text-muted-foreground font-mono text-xs tracking-widest uppercase md:col-span-1">{input.label}</h2>
			<div className="min-w-0 md:col-span-3">{input.children}</div>
		</section>
	)
}

export const Route = createFileRoute('/3d')({component: Page3D})

function Page3D() {
	const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
	const [assembly, setAssembly] = useState(() => Boolean.match(reduced, {onFalse: () => 0, onTrue: () => 1}))
	const [selected, setSelected] = useState(1)

	function onScroll(event: React.UIEvent<HTMLDivElement>) {
		if (reduced) return
		setAssembly(assemblyAt(event.currentTarget.scrollTop, event.currentTarget.clientHeight))
	}

	return (
		<div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto font-mono" onScroll={onScroll}>
			<header className="border-border bg-background sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 text-xs sm:px-6">
				<span className="text-foreground tracking-widest uppercase">Matteo Paludgnach</span>
				<nav className="text-muted-foreground flex gap-4">
					<a href="/" className="hover:text-foreground focus-visible:ring-ring transition-colors focus-visible:ring-2">
						Home
					</a>
				</nav>
			</header>

			<section className="grid items-center gap-10 px-4 py-10 sm:px-6 md:grid-cols-2 lg:px-12">
				<div className="flex flex-col gap-6">
					<p className="text-muted-foreground text-xs tracking-widest uppercase">Full-Stack TypeScript Developer</p>
					<div>
						<h1 className="text-foreground text-5xl font-black tracking-wider uppercase">Matteo</h1>
						<h2 className="text-foreground/50 text-3xl tracking-widest uppercase">Paludgnach</h2>
					</div>
					<p className="text-muted-foreground text-sm">Moimacco (UD), Italy</p>
					<p className="text-muted-foreground text-sm">React · TypeScript · Effect · Real-time</p>
				</div>

				<figure className="border-border flex flex-col gap-4 border p-4">
					<div className="text-muted-foreground flex items-center justify-between text-xs">
						<span>Fig 1</span>
						<span>Stack</span>
					</div>
					<Figure assembly={assembly} className="w-full" selected={selected} />
					<div className="text-muted-foreground flex items-center justify-between text-xs">
						<span>Scroll to assemble</span>
						<span className="text-foreground tabular-nums">Assembled {Number.round(assembly * 100, 0)}%</span>
					</div>
				</figure>
			</section>

			<Row label="About">
				<div className="flex flex-col gap-4">
					{Array.map(ABOUT, line => (
						<p key={line} className="text-foreground/90 max-w-prose text-sm leading-7 sm:text-base">
							{line}
						</p>
					))}
				</div>
			</Row>

			<Row label="Skills">
				<p className="text-muted-foreground mb-4 text-xs">
					Each skill is one plate of the stack. Select one to light it.
				</p>
				<div className="bg-background sticky top-12 z-0 pb-4">
					<Figure assembly={1} className="mx-auto w-full max-w-72" selected={selected} />
				</div>
				<ul className="flex flex-col">
					{Array.map(SKILLS, (skill, index) => {
						const isSelected = selected === index
						return (
							<li key={skill.area} className="border-border border-b first:border-t">
								<Button
									variant="ghost"
									aria-pressed={isSelected}
									onPointerEnter={() => setSelected(index)}
									onFocus={() => setSelected(index)}
									onClick={() => setSelected(index)}
									className={cn(
										'h-auto w-full justify-start gap-4 py-3 font-normal whitespace-normal',
										isSelected && 'bg-accent'
									)}
								>
									<skill.icon
										className={cn(
											'size-4 shrink-0',
											Boolean.match(isSelected, {onFalse: () => 'text-muted-foreground', onTrue: () => 'text-primary'})
										)}
									/>
									<span className="flex flex-1 flex-col items-start gap-1 text-left">
										<span className="text-foreground text-sm font-semibold tracking-widest uppercase">
											{skill.area}
										</span>
										<span className="text-muted-foreground text-xs leading-6">{skill.items}</span>
									</span>
								</Button>
							</li>
						)
					})}
				</ul>
			</Row>

			<Row label="Personal Projects">
				<div className="flex flex-col gap-8">
					{Array.map(PROJECTS, item => (
						<article key={item.name} className="flex flex-col gap-3">
							<div className="flex items-start justify-between gap-3">
								<div>
									<h3 className="text-foreground text-sm font-semibold tracking-widest uppercase">{item.name}</h3>
									<p className="text-muted-foreground mt-1 text-xs">{item.role}</p>
								</div>
								<a
									href={item.href}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={`View ${item.name} on GitHub`}
									className="text-primary hover:text-primary/80 focus-visible:ring-ring transition-colors focus-visible:ring-2"
								>
									<ArrowUpRight className="size-4" />
								</a>
							</div>
							<p className="text-foreground/90 text-sm leading-6">{item.description}</p>
							{Predicate.isNotUndefined(item.currentWork) && (
								<p className="text-muted-foreground text-xs leading-5">
									<span className="text-foreground/80">Working on:</span> {item.currentWork}
								</p>
							)}
							<p className="text-muted-foreground/80 text-xs">{item.stack}</p>
						</article>
					))}
				</div>
			</Row>

			<Row label="Experience">
				<div className="flex flex-col gap-8">
					{Array.map(EXPERIENCE, job => (
						<article key={job.company} className="flex flex-col gap-2">
							<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
								<p className="text-foreground text-sm font-semibold tracking-widest uppercase">{job.company}</p>
								<p className="text-muted-foreground text-xs">
									{job.period} · {job.location}
								</p>
							</div>
							<p className="text-muted-foreground text-xs">
								{job.role}
								{String.isNonEmpty(job.note) && <span className="text-muted-foreground/80"> · {job.note}</span>}
							</p>
							<ul className="mt-2 flex flex-col gap-1.5">
								{Array.map(job.highlights, highlight => (
									<li key={highlight} className="text-foreground/85 flex items-start gap-2 text-sm leading-6">
										<span className="bg-foreground/50 mt-2 size-1 shrink-0 rounded-full" aria-hidden="true" />
										<span>{highlight}</span>
									</li>
								))}
							</ul>
						</article>
					))}
				</div>
			</Row>

			<Row label="Education & Languages">
				<div className="flex flex-col gap-8">
					{Array.map(EDUCATION, entry => (
						<article key={entry.school} className="flex flex-col gap-2">
							<div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
								<p className="text-foreground text-sm font-semibold">
									{entry.school}
									{String.isNonEmpty(entry.grade) && (
										<span className="text-muted-foreground/80 font-normal"> ({entry.grade})</span>
									)}
								</p>
								<p className="text-muted-foreground text-xs">{entry.period}</p>
							</div>
							<p className="text-muted-foreground text-xs">{entry.degree}</p>
							<p className="text-foreground/85 text-sm leading-6">{entry.description}</p>
						</article>
					))}
					<dl className="grid gap-3 sm:grid-cols-3">
						{Array.map(LANGUAGES, lang => (
							<div key={lang.language} className="border-border flex items-baseline gap-2 border-t pt-3">
								<dt className="text-foreground text-sm font-semibold">{lang.language}</dt>
								<dd className="text-muted-foreground text-xs">{lang.level}</dd>
							</div>
						))}
					</dl>
				</div>
			</Row>

			<Row label="Contact">
				<div className="flex flex-col">
					{Array.map(CONTACT, item => (
						<a
							key={item.label}
							href={item.href}
							target="_blank"
							rel="noopener noreferrer"
							className="border-border hover:text-primary focus-visible:ring-ring flex flex-col gap-1 border-b py-3 text-sm transition-colors first:border-t focus-visible:ring-2 sm:flex-row sm:items-center sm:justify-between"
						>
							<span className="text-muted-foreground text-xs tracking-widest uppercase">{item.label}</span>
							<span className="text-foreground break-all">{item.value}</span>
						</a>
					))}
				</div>
				<p className="text-muted-foreground/70 mt-6 text-xs">© 2026 Matteo Paludgnach · Moimacco (UD), Italy</p>
			</Row>
		</div>
	)
}
