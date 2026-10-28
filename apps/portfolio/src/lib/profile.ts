import {Boxes, Monitor, Server, Sparkles} from 'lucide-react'

// The single source for the home page and the CV, cut to what fits one printed A4 page.

export const profile = {
	firstName: 'Matteo',
	lastName: 'Paludgnach',
	location: 'Moimacco (UD), Italy',
	portfolio: 'portfolio.mp281x.xyz',
	title: 'Full-Stack TypeScript Developer',
	// Italian law asks a VAT holder's website to show the number on its home page.
	vat: 'IT03224930309'
}

export const contacts = {
	email: {href: 'mailto:matteo@mp281x.xyz', label: 'Email', value: 'matteo@mp281x.xyz'},
	github: {href: 'https://github.com/MP281X', label: 'GitHub', value: 'github.com/MP281X'},
	pec: {href: 'mailto:matteo.paludgnach@pec.it', label: 'PEC', value: 'matteo.paludgnach@pec.it'},
	phone: {href: 'tel:+393518853376', label: 'Phone', value: '+39 351 885 3376'}
}

export const summary = 'Building AI agents and web apps end to end with Effect and React.'

export const skills = [
	{
		area: 'Frontend',
		icon: Monitor,
		items: 'TypeScript, React, TanStack (Router, Query, Form, Table), Tailwind CSS, Vite+ (Vite, Vitest, Oxlint)'
	},
	{area: 'Backend & Data', icon: Server, items: 'Effect, Node.js, Bun, PostgreSQL, Drizzle, OpenAPI, SSE'},
	{area: 'AI', icon: Sparkles, items: 'AI agents, MCP servers, Claude Code, Codex, OpenCode'},
	{
		area: 'Cloud & DevOps',
		icon: Boxes,
		items: 'Docker, AWS, CI/CD (GitHub Actions, GitLab CI), OpenTelemetry, Git, Linux'
	}
]

export const projects = [
	{
		description:
			'A template monorepo built for coding agents: generators, shared patterns, lint rules and skills keep the Effect web and iOS apps they write consistent and high quality.',
		href: 'https://github.com/MP281X/deslop',
		name: 'deslop',
		role: 'Monorepo Template for Coding Agents',
		stack: 'Effect · React · TypeScript · Expo · Vite+ · MCP'
	},
	{
		description: 'An open-source video platform with FFmpeg/HLS processing and real-time upload progress.',
		href: 'https://github.com/MP281X/blixter_video',
		name: 'blixter',
		role: 'Video Streaming Platform',
		stack: 'TypeScript · FFmpeg · PostgreSQL · Redis'
	}
]

export const experience = [
	{
		company: 'Datapizza',
		highlights: [
			'Building Dual, Datapizza’s platform for AI agents and workflow automation',
			'Reworked the frontend architecture and the monorepo’s build, lint and CI tooling'
		],
		note: 'Freelance',
		period: 'Sep 2026 – Present',
		role: 'Full-Stack Developer'
	},
	{
		company: 'Humans.Tech',
		highlights: [
			'Set up the shared frontend architecture and tooling for new products',
			'Built chat interfaces for conversations between people and with AI agents',
			'Built UI primitives such as tables and virtualized lists for large datasets'
		],
		location: 'Frosinone, Italy',
		period: 'Apr 2026 – Jul 2026',
		role: 'Frontend Developer'
	},
	{
		company: 'Tinexta Cyber',
		highlights: [
			'Built a real-time inventory of devices and cabling for a major telecom company',
			'Used ElectricSQL in the React frontend to sync every change live to all connected users',
			'Generated a typed API client from the backend’s OpenAPI schema',
			'Containerized and deployed services with Docker'
		],
		location: 'Udine, Italy',
		period: 'Oct 2024 – Mar 2026',
		role: 'Full-Stack Developer'
	},
	{
		company: 'Altitudo',
		highlights: [
			'Migrated the build system from Create React App to Vite',
			'Improved rendering performance with targeted memoization'
		],
		location: 'Salzburg, Austria',
		note: 'Erasmus Internship',
		period: 'Jan 2024 – Mar 2024',
		role: 'Frontend Developer'
	},
	{
		company: 'BizAway',
		highlights: [
			'Built a type-safe end-to-end API testing framework on the OpenAPI schema',
			'Built a type-safe email template framework from TSX components'
		],
		location: 'Spilimbergo, Italy',
		note: 'Internship',
		period: 'Jun 2023 – Aug 2023',
		role: 'Backend Developer'
	}
]

export const education = [
	{degree: 'Cloud Developer Diploma', grade: '95/100', period: '2022 – 2024', school: 'ITS Alto Adriatico'}
]

export const languages = [
	{language: 'Italian', level: 'Native'},
	{language: 'English', level: 'C1'},
	{language: 'Spanish', level: 'Basic'}
]
