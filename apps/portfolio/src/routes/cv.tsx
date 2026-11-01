import {Array, Predicate, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {Printer} from 'lucide-react'

import {Button} from '@deslop/components-web/ui/button'

import {contacts, education, experience, languages, profile, projects, skills, summary} from '#lib/profile.ts'

function Link(input: {contact: {href: string; value: string}}) {
	return (
		<a href={input.contact.href} className="hover:underline">
			{input.contact.value}
		</a>
	)
}

function CvSection(input: {title: string; children: React.ReactNode}) {
	return (
		<section className="flex flex-col gap-1">
			<h2 className="text-foreground text-label tracking-label font-mono font-bold uppercase">{input.title}</h2>
			{input.children}
		</section>
	)
}

// ATS parsers read the PDF's text, not its layout: fields are split by a visible character, never by a gap alone.
function Entry(input: {title: string; details: string[]; aside: string; children?: React.ReactNode}) {
	return (
		<div className="flex break-inside-avoid flex-col gap-0.5">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4">
				<h3>
					<strong className="font-semibold">{input.title}</strong>
					{Array.map(input.details, detail => (
						<span key={detail} className="text-foreground/70">
							{' · '}
							{detail}
						</span>
					))}
				</h3>
				<span className="text-foreground/70 text-label font-mono whitespace-nowrap">{input.aside}</span>
			</div>
			{input.children}
		</div>
	)
}

function Bullets(input: {items: string[]}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{Array.map(input.items, item => (
				<li key={item} className="flex gap-2.5">
					<span aria-hidden className="border-foreground/75 mt-1.75 size-1 shrink-0 border-2" />
					<span>{item}</span>
				</li>
			))}
		</ul>
	)
}

// Drawn line by line: PDF viewers render a tiled background unevenly and drop some of its lines.
function HeaderGrid() {
	return (
		<svg
			aria-hidden
			className="text-foreground pointer-events-none absolute inset-0 -z-1 size-full border-r border-current opacity-7"
		>
			{Array.makeBy(31, column => (
				<line
					key={`column-${column}`}
					x1={column * 26 + 0.5}
					x2={column * 26 + 0.5}
					y1={0}
					y2="100%"
					stroke="currentColor"
				/>
			))}
			{Array.makeBy(11, row => (
				<line key={`row-${row}`} x1={0} x2="100%" y1={row * 26 + 0.5} y2={row * 26 + 0.5} stroke="currentColor" />
			))}
		</svg>
	)
}

function CvRoute() {
	return (
		<div className="pb-safe min-h-0 flex-1 overflow-y-auto px-6 pt-12 select-text print:overflow-visible print:p-0">
			<Button
				variant="outline"
				size="icon"
				aria-label="Print or save as PDF"
				onClick={() => {
					print()
				}}
				className="fixed top-3 right-3 print:hidden"
			>
				<Printer />
			</Button>

			<article
				lang="en"
				className="font-document text-document print:min-h-printed-page trail-grid-width mx-auto flex flex-col gap-3 print:justify-between"
			>
				<header className="border-foreground relative isolate flex h-65.5 flex-col justify-between border-b-2 pt-4 pb-3 font-mono sm:h-46">
					<HeaderGrid />
					<h1 className="tracking-name text-2xl leading-none font-extrabold uppercase">
						{profile.firstName}{' '}
						<span className="text-foreground/55 tracking-label mt-0.5 block text-xl font-medium">
							{profile.lastName}
						</span>
					</h1>
					<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
						<div className="flex flex-col gap-1">
							<p className="text-label tracking-label flex items-center gap-2 whitespace-nowrap uppercase">
								<span aria-hidden className="border-foreground size-2 border-4" />
								{profile.title}
							</p>
							<p className="font-document text-document">{summary}</p>
						</div>
						<address className="text-foreground/70 text-label whitespace-nowrap not-italic sm:text-right">
							{profile.location} · <Link contact={contacts.phone} />
							<br />
							<Link contact={contacts.email} /> · <Link contact={contacts.github} />
							<br />
							PEC <Link contact={contacts.pec} />
							<br />
							<Link contact={{href: `https://${profile.portfolio}`, value: profile.portfolio}} /> · VAT {profile.vat}
						</address>
					</div>
				</header>

				<CvSection title="Technical Skills">
					<dl className="flex flex-col gap-0.5">
						{Array.map(skills, skill => (
							<div key={skill.area} className="flex">
								<dt className="w-32 shrink-0 font-semibold">{skill.area}:</dt>
								<dd>{skill.items}</dd>
							</div>
						))}
					</dl>
				</CvSection>

				<CvSection title="Work Experience">
					<div className="flex flex-col gap-1.5">
						{Array.map(experience, job => (
							<Entry
								key={job.company}
								title={job.company}
								details={Array.filter([job.role, job.note, job.location], Predicate.isNotUndefined)}
								aside={job.period}
							>
								<Bullets items={job.highlights} />
							</Entry>
						))}
					</div>
				</CvSection>

				<CvSection title="Projects">
					<div className="flex flex-col gap-1.5">
						{Array.map(projects, project => (
							<Entry
								key={project.name}
								title={project.name}
								details={[project.role]}
								aside={pipe(project.href, String.replace('https://', ''))}
							>
								<p>{project.description}</p>
							</Entry>
						))}
					</div>
				</CvSection>

				<CvSection title="Education & Languages">
					{Array.map(education, entry => (
						<Entry
							key={entry.school}
							title={entry.degree}
							details={Array.filter([entry.school, entry.grade], Predicate.isNotUndefined)}
							aside={entry.period}
						/>
					))}
					<p>
						<strong className="font-semibold">Languages:</strong>{' '}
						{pipe(
							languages,
							Array.map(entry => `${entry.language} (${entry.level})`),
							Array.join(' · ')
						)}
					</p>
				</CvSection>
			</article>
		</div>
	)
}

export const Route = createFileRoute('/cv')({
	component: CvRoute,
	// The title names the PDF a browser saves, and the file a recruiter downloads.
	head: () => ({
		meta: [
			{title: `${profile.firstName} ${profile.lastName} CV`},
			{content: `${profile.firstName} ${profile.lastName}`, name: 'author'},
			{content: `${profile.title}. ${summary}`, name: 'description'}
		]
	})
})
