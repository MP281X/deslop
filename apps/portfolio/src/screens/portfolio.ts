import {Array, Predicate, Schema, String, pipe} from 'effect'

import {PortfolioRoute} from '#screens/routes.ts'

// The single source for the home page and the CV, cut to what fits one printed A4 page.

const PROFILE = {
	firstName: 'Matteo',
	lastName: 'Paludgnach',
	location: 'Moimacco (UD), Italy',
	portfolio: 'portfolio.mp281x.xyz',
	title: 'Full-Stack TypeScript Developer',
	vat: 'IT03224930309'
}

const CONTACTS = {
	email: {href: 'mailto:matteo@mp281x.xyz', label: 'Email', value: 'matteo@mp281x.xyz'},
	github: {href: 'https://github.com/MP281X', label: 'GitHub', value: 'github.com/MP281X'},
	pec: {href: 'mailto:matteo.paludgnach@pec.it', label: 'PEC', value: 'matteo.paludgnach@pec.it'},
	phone: {href: 'tel:+393518853376', label: 'Phone', value: '+39 351 885 3376'}
}

const SUMMARY = 'Building AI agents and web apps end to end with Effect and React.'

const SKILLS = [
	{
		area: 'Frontend',
		icon: 'monitor',
		items: 'TypeScript, React, TanStack (Router, Query, Form, Table), Tailwind CSS, Vite+ (Vite, Vitest, Oxlint)'
	},
	{area: 'Backend & Data', icon: 'hardDrives', items: 'Effect, Node.js, Bun, PostgreSQL, Drizzle, OpenAPI, SSE'},
	{area: 'AI', icon: 'sparkle', items: 'AI agents, MCP servers, Claude Code, Codex, OpenCode'},
	{
		area: 'Cloud & DevOps',
		icon: 'stack',
		items: 'Docker, AWS, CI/CD (GitHub Actions, GitLab CI), OpenTelemetry, Git, Linux'
	}
] as const

const PROJECTS = [
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

const EXPERIENCE = [
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

const EDUCATION = [
	{degree: 'Cloud Developer Diploma', grade: '95/100', period: '2022 – 2024', school: 'ITS Alto Adriatico'}
]

const LANGUAGES = [
	{language: 'Italian', level: 'Native'},
	{language: 'English', level: 'C1'},
	{language: 'Spanish', level: 'Basic'}
]

export type SectionName = typeof SectionName.Type
export const SectionName = Schema.Literals(['profile', 'skills', 'experience', 'projects', 'education', 'contact'])

const name = `${PROFILE.firstName} ${PROFILE.lastName}`
const homePath = PortfolioRoute.print(PortfolioRoute.Home())
const cvPath = PortfolioRoute.print(PortfolioRoute.Cv())
const website = {href: `https://${PROFILE.portfolio}`, value: PROFILE.portfolio}

export const ProfileScreen = {
	contactRows: [
		{...CONTACTS.email, icon: 'envelope'},
		{...CONTACTS.pec, icon: 'sealCheck'},
		{...CONTACTS.phone, icon: 'phone'},
		{...CONTACTS.github, icon: 'github'},
		{href: cvPath, icon: 'fileText', label: 'CV', value: `${PROFILE.portfolio}${cvPath}`}
	],
	contacts: CONTACTS,
	cvPath,
	education: EDUCATION,
	experience: EXPERIENCE,
	languages: LANGUAGES,
	name,
	profile: PROFILE,
	projects: PROJECTS,
	skills: SKILLS,
	summary: SUMMARY
} as const

export const CvScreen = {
	contacts: CONTACTS,
	education: Array.map(EDUCATION, entry => ({
		aside: entry.period,
		details: Array.filter([entry.school, entry.grade], Predicate.isNotUndefined),
		title: entry.degree
	})),
	experience: Array.map(EXPERIENCE, job => ({
		aside: job.period,
		details: Array.filter([job.role, job.note, job.location], Predicate.isNotUndefined),
		highlights: job.highlights,
		title: job.company
	})),
	homePath,
	languages: pipe(
		LANGUAGES,
		Array.map(entry => `${entry.language} (${entry.level})`),
		Array.join(' · ')
	),
	profile: PROFILE,
	projects: Array.map(PROJECTS, project => ({
		aside: String.replace('https://', '')(project.href),
		description: project.description,
		details: [project.role],
		title: project.name
	})),
	skills: SKILLS,
	summary: SUMMARY,
	title: `${name} CV`,
	website
}
