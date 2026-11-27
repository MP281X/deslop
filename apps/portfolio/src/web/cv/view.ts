import {Command, Head} from '@effect/ui'
import type {View} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Effect, Function, Predicate, Schema, String, pipe} from 'effect'

import {contacts, education, experience, languages, profile, projects, skills, summary} from '#web/profile/content.ts'
import {Icon} from '#web/profile/icons.ts'
import {PortfolioRoute} from '#web/routes.ts'

type H = Html.H<'Print'>

const Print = Command.make('Portfolio/Print', {args: {}}, () => Effect.sync(() => print()))

function Link(h: H, contact: {href: string; value: string}) {
	return h.a.class('hover:underline').attr('href', contact.href).children(contact.value)
}

function CvSection(h: H, title: string, body: View.Input<'Print'>) {
	return h.section
		.class('flex flex-col gap-1')
		.children(
			h.h2.class('text-foreground text-label tracking-label font-mono font-bold uppercase').children(title),
			body
		)
}

// ATS parsers read the PDF's text, not its layout: the title and details share a heading split by visible dots, never by a gap alone; the aside is a separate, right-aligned span.
function Entry(h: H, input: {title: string; details: string[]; aside: string; body?: View.Input<'Print'>}) {
	return h.div
		.key(input.title)
		.class('flex break-inside-avoid flex-col gap-0.5')
		.children(
			h.div.class('flex flex-wrap items-baseline justify-between gap-x-4').children(
				h.h3.children(
					h.strong.class('font-semibold').children(input.title),
					Array.map(input.details, detail => h.span.key(detail).class('text-foreground/70').children(` · ${detail}`))
				),
				h.span.class('text-foreground/70 text-label font-mono whitespace-nowrap').children(input.aside)
			),
			input.body
		)
}

function Bullets(h: H, items: string[]) {
	return h.ul
		.class('flex flex-col gap-0.5')
		.children(
			Array.map(items, item =>
				h.li
					.key(item)
					.class('flex gap-2.5')
					.children(
						h.span.attr('aria-hidden', 'true').class('border-foreground/75 mt-1.75 size-1 shrink-0 border-2'),
						h.span.children(item)
					)
			)
		)
}

// Drawn line by line: PDF viewers render a tiled background unevenly and drop some of its lines.
function HeaderGrid(h: H) {
	return h
		.el('svg')
		.attrs({
			'aria-hidden': 'true',
			class: 'text-foreground pointer-events-none absolute inset-0 -z-1 size-full border-r border-current opacity-7'
		})
		.children(
			Array.makeBy(31, column =>
				h
					.el('line')
					.key(`column-${column}`)
					.attrs({stroke: 'currentColor', x1: `${column * 26 + 0.5}`, x2: `${column * 26 + 0.5}`, y1: '0', y2: '100%'})
			),
			Array.makeBy(11, row =>
				h
					.el('line')
					.key(`row-${row}`)
					.attrs({stroke: 'currentColor', x1: '0', x2: '100%', y1: `${row * 26 + 0.5}`, y2: `${row * 26 + 0.5}`})
			)
		)
}

function Header(h: H) {
	return h.header
		.class(
			'border-foreground relative isolate flex h-65.5 flex-col justify-between border-b-2 pt-4 pb-3 font-mono sm:h-46'
		)
		.children(
			HeaderGrid(h),
			h.h1
				.class('tracking-name text-2xl leading-none font-extrabold uppercase')
				.children(
					`${profile.firstName} `,
					h.span.class('text-foreground/55 tracking-label mt-0.5 block text-xl font-medium').children(profile.lastName)
				),
			h.div
				.class('flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6')
				.children(
					h.div
						.class('flex flex-col gap-1')
						.children(
							h.p
								.class('text-label tracking-label flex items-center gap-2 whitespace-nowrap uppercase')
								.children(h.span.attr('aria-hidden', 'true').class('border-foreground size-2 border-4'), profile.title),
							h.p.class('font-document text-document').children(summary)
						),
					h.address
						.class('text-foreground/70 text-label whitespace-nowrap not-italic sm:text-right')
						.children(
							`${profile.location} · `,
							Link(h, contacts.phone),
							h.br,
							Link(h, contacts.email),
							' · ',
							Link(h, contacts.github),
							h.br,
							'PEC ',
							Link(h, contacts.pec),
							h.br,
							Link(h, {href: `https://${profile.portfolio}`, value: profile.portfolio}),
							` · VAT ${profile.vat}`
						)
				)
		)
}

export const Cv = Html.component({message: Schema.Literal('Print'), model: Schema.Void, name: 'PortfolioCV'}).make({
	head: () => [Head.title(`${profile.firstName} ${profile.lastName} CV`)],
	init: Function.constUndefined,
	update: $ => $.run(Command.asNoop(Print.make({}))),
	view: h =>
		h.main
			.class(
				'pb-safe-bottom min-h-0 flex-1 overflow-y-auto px-6 pt-20 select-text sm:pt-16 print:overflow-visible print:p-0'
			)
			.children(
				h.a
					.attr('href', PortfolioRoute.print(PortfolioRoute.Home()))
					.class(
						'text-muted-foreground hover:text-foreground mt-safe-top ml-safe-left fixed top-3 left-3 z-20 inline-flex h-11 items-center gap-1.5 font-mono text-xs sm:h-9 print:hidden'
					)
					.children(h.span.attr('aria-hidden', 'true').children('←'), 'Portfolio'),
				h.div.class('mt-safe-top mr-safe-right fixed top-3 right-3 flex print:hidden').children(
					h.button
						.class('portfolio-button cv-print size-9')
						.attrs({'aria-label': 'Print or save as PDF', type: 'button'})
						.on('click', 'Print')
						.children(Icon(h, 'printer', 'size-4'))
				),
				h.article
					.attr('lang', 'en')
					.class(
						'font-document text-document print:min-h-printed-page trail-grid-width mx-auto flex flex-col gap-3 print:justify-between'
					)
					.children(
						Header(h),
						CvSection(
							h,
							'Technical Skills',
							h.dl.class('flex flex-col gap-0.5').children(
								Array.map(skills, skill =>
									h.div
										.key(skill.area)
										.class('flex')
										.children(
											h.dt.class('w-32 shrink-0 font-semibold').children(`${skill.area}:`),
											h.dd.children(skill.items)
										)
								)
							)
						),
						CvSection(
							h,
							'Work Experience',
							h.div
								.class('flex flex-col gap-1.5')
								.children(
									Array.map(experience, job =>
										Entry(h, {
											aside: job.period,
											body: Bullets(h, job.highlights),
											details: Array.filter([job.role, job.note, job.location], Predicate.isNotUndefined),
											title: job.company
										})
									)
								)
						),
						CvSection(
							h,
							'Projects',
							h.div
								.class('flex flex-col gap-1.5')
								.children(
									Array.map(projects, project =>
										Entry(h, {
											aside: String.replace('https://', '')(project.href),
											body: h.p.children(project.description),
											details: [project.role],
											title: project.name
										})
									)
								)
						),
						h.section.class('flex flex-col gap-1').children(
							h.h2
								.class('text-foreground text-label tracking-label font-mono font-bold uppercase')
								.children('Education & Languages'),
							Array.map(education, entry =>
								Entry(h, {
									aside: entry.period,
									details: Array.filter([entry.school, entry.grade], Predicate.isNotUndefined),
									title: entry.degree
								})
							),
							h.p.children(
								h.strong.class('font-semibold').children('Languages:'),
								' ',
								pipe(
									languages,
									Array.map(entry => `${entry.language} (${entry.level})`),
									Array.join(' · ')
								)
							)
						)
					)
			)
})
