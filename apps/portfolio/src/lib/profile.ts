import {Boxes, Monitor, Server, Sparkles} from 'lucide-react'

// The single source for the home page and the CV, cut to what fits one printed A4 page.

export const profile = {
	firstName: 'Matteo',
	lastName: 'Paludgnach',
	location: 'Moimacco (UD), Italy',
	portfolio: 'portfolio.mp281x.xyz',
	stack: 'React · TypeScript · Effect · Real-time',
	title: 'Full-Stack TypeScript Developer'
}

export const contacts = {
	email: {href: 'mailto:paludgnachmatteo.dev@gmail.com', label: 'Email', value: 'paludgnachmatteo.dev@gmail.com'},
	github: {href: 'https://github.com/MP281X', label: 'GitHub', value: 'github.com/MP281X'},
	phone: {href: 'tel:+393518853376', label: 'Phone', value: '+39 351 885 3376'}
}

export const summary = 'I’m a full-stack TypeScript developer specializing in Effect, React, and AI agents.'

export const skills = [
	{
		area: 'Frontend',
		icon: Monitor,
		items: 'React, TypeScript, JavaScript, TanStack (Router, Table, Form), Tailwind CSS'
	},
	{
		area: 'Backend & Data',
		icon: Server,
		items: 'Effect, Node.js, type-safe RPC, OpenAPI, PostgreSQL, Redis, WebSockets, SSE'
	},
	{area: 'DevOps', icon: Boxes, items: 'Docker, CI/CD (GitHub Actions, Jenkins), Git, Linux'},
	{area: 'AI Tooling', icon: Sparkles, items: 'Codex, Claude Code, OpenCode, GitHub Copilot, MCP'}
]

export const projects = [
	{
		description:
			'A monorepo of my Effect apps and MCP tools on one shared runtime. It publishes @deslop/coding-standards, a lint preset with agent skills.',
		href: 'https://github.com/MP281X/deslop',
		name: 'deslop',
		role: 'Effect Monorepo & Agent Tooling',
		stack: 'Effect · React · TypeScript · Expo · MCP · Docker'
	},
	{
		description: 'An open-source video platform with FFmpeg/HLS processing and real-time upload progress.',
		href: 'https://github.com/MP281X/blixter_video',
		name: 'Blixter',
		role: 'Video Streaming Platform',
		stack: 'TypeScript · FFmpeg · PostgreSQL · Redis'
	}
]

type Job = {company: string; highlights: string[]; location?: string; note?: string; period: string; role: string}

export const experience: Job[] = [
	{
		company: 'Datapizza',
		highlights: ['Building Dual, Datapizza’s platform for AI agents and workflow automation'],
		note: 'Full-time freelance',
		period: 'Sep 2026 – Present',
		role: 'Full-Stack Developer'
	},
	{
		company: 'Humans.Tech',
		highlights: [
			'Built the shared frontend foundation for new products: reusable architecture, tooling, and conventions',
			'Developed reusable messaging interfaces for person-to-person and AI-agent conversations',
			'Created reusable data-display primitives, including tables and virtualized lists for large datasets'
		],
		location: 'Frosinone, Italy',
		period: 'Apr 2026 – Jul 2026',
		role: 'Frontend Developer'
	},
	{
		company: 'Tinexta Cyber',
		highlights: [
			'Developed a real-time inventory of devices and cabling across a major telecom’s datacenters',
			'Built the React frontend on ElectricSQL, so every connected user sees changes live',
			'Generated a type-safe RPC-like client from the backend’s OpenAPI schema',
			'Containerized and deployed services with Docker and Jenkins CI/CD'
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

type Education = {degree: string; grade?: string; period: string; school: string}

export const education: Education[] = [
	{degree: 'Cloud Developer Diploma', grade: '95/100', period: '2022 – 2024', school: 'ITS Alto Adriatico'},
	{degree: 'High School Diploma – IT and Telecommunications', period: '2017 – 2022', school: 'ISIS A. Malignani'}
]

export const languages = [
	{language: 'Italian', level: 'Native'},
	{language: 'English', level: 'C1'},
	{language: 'Spanish', level: 'Basic'}
]
