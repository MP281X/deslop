import type {View} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Predicate, String, pipe} from 'effect'

import {ProfileScreen, SectionName} from '#screens/portfolio.ts'
import {Icon} from '#web/profile/icons.ts'

type SectionName = typeof SectionName.Type
const {contactRows, education, experience, languages, name, profile, projects, skills, summary} = ProfileScreen
export const sectionTargets = {
	contact: Html.ref('contact', 'section'),
	education: Html.ref('education', 'section'),
	experience: Html.ref('experience', 'section'),
	profile: Html.ref('profile', 'section'),
	projects: Html.ref('projects', 'section'),
	skills: Html.ref('skills', 'section')
}

// The page's content over the trail grid: one opaque column, rows split by hairlines; its words select like a document's.
function Panel<M>(h: Html.H<M>, className: string, ...body: View.Input<M>[]) {
	return h.div.class('panel-frosted border-border border select-text', className).children(...body)
}

function Section<M>(h: Html.H<M>, name: SectionName, body: View.Input<M>, bottomPadding = 'pb-4 sm:pb-6') {
	return h.section
		.ref(sectionTargets[name])
		.class('relative z-10 flex flex-col items-center overflow-hidden px-3 pt-4 sm:px-6 sm:pt-6', bottomPadding)
		.children(body)
}

// A section of the column; its name stays for assistive technology, not on the card.
function SectionBody<M>(h: Html.H<M>, title: string, body: View.Input<M>) {
	return Panel(h, 'flex w-full max-w-3xl flex-col p-4 sm:p-6', h.h2.class('sr-only').children(title), body)
}

// The masthead is the first panel: role and place set the stage, the name is the one display statement.
function ProfileSection<M>(h: Html.H<M>) {
	return Section(
		h,
		'profile',
		Panel(
			h,
			'mt-6 flex w-full max-w-3xl flex-col gap-3 px-4 py-6 sm:mt-14 sm:px-6',
			h.h1.class('text-foreground text-4xl font-semibold tracking-tight sm:text-5xl').children(name),
			h.p.class('text-primary font-mono text-sm').children(profile.title),
			h.p.class('text-foreground/90 text-base').children(summary),
			h.p.class('text-muted-foreground font-mono text-xs').children(profile.location)
		)
	)
}

function SkillsSection<M>(h: Html.H<M>) {
	return Section(
		h,
		'skills',
		SectionBody(
			h,
			'skills',
			Array.map(skills, skill =>
				h.div
					.key(skill.area)
					.class('flex flex-col gap-1 py-3 sm:flex-row sm:gap-6')
					.children(
						h.h3
							.class('flex w-40 shrink-0 items-center gap-2 text-sm font-medium sm:self-start')
							.children(Icon(h, skill.icon, 'text-primary size-4'), skill.area),
						h.p.class('text-muted-foreground text-sm').children(skill.items)
					)
			)
		)
	)
}

function ProjectRow<M>(
	h: Html.H<M>,
	project: {description: string; href: string; name: string; role: string; stack: string}
) {
	return h.div
		.key(project.name)
		.class('flex flex-col gap-1 py-3')
		.children(
			h.div.class('flex items-center justify-between gap-3').children(
				h.h3
					.class('text-sm font-medium')
					.children(project.name, h.span.class('text-muted-foreground ml-2 font-normal').children(project.role)),
				// The arrow keeps a 44px phone target without making its line taller than the title.
				h.a
					.attrs({
						'aria-label': `View ${project.name} on GitHub`,
						href: project.href,
						rel: 'noopener noreferrer',
						target: '_blank'
					})
					.class(
						'text-primary hover:text-primary/80 max-sm:relative max-sm:inline-flex max-sm:size-5 max-sm:items-center max-sm:justify-center max-sm:after:absolute max-sm:after:-inset-3'
					)
					.children(Icon(h, 'arrowUpRight', 'size-4'))
			),
			h.p.class('text-foreground/90 text-sm').children(project.description),
			h.p.class('text-muted-foreground font-mono text-xs').children(project.stack)
		)
}

function ExperienceSection<M>(h: Html.H<M>) {
	return Section(
		h,
		'experience',
		SectionBody(
			h,
			'experience',
			Array.map(experience, job =>
				h.div
					.key(job.company)
					.class('flex flex-col gap-2 py-3')
					.children(
						h.div
							.class('flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between')
							.children(
								h.h3
									.class('text-sm font-medium')
									.children(
										job.company,
										h.span
											.class('text-muted-foreground ml-2 font-normal')
											.children(job.role, Predicate.isNotUndefined(job.note) && ` · ${job.note}`)
									),
								h.p
									.class('text-muted-foreground font-mono text-xs sm:text-right')
									.children(pipe([job.period, job.location], Array.filter(Predicate.isNotUndefined), Array.join(' · ')))
							),
						h.ul
							.class('flex flex-col gap-1')
							.children(
								Array.map(job.highlights, highlight =>
									h.li
										.key(highlight)
										.class('text-foreground/90 flex items-start gap-2 text-sm')
										.children(
											h.span.attr('aria-hidden', 'true').class('bg-muted-foreground mt-2 size-1 shrink-0 rounded-full'),
											h.span.children(highlight)
										)
								)
							)
					)
			)
		)
	)
}

function EducationSection<M>(h: Html.H<M>) {
	return Section(
		h,
		'education',
		SectionBody(h, 'education and languages', [
			...Array.map(education, entry =>
				h.div
					.key(entry.school)
					.class('flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3')
					.children(
						h.h3
							.class('text-sm font-medium')
							.children(
								entry.school,
								h.span
									.class('text-muted-foreground ml-2 font-normal')
									.children(entry.degree, Predicate.isNotUndefined(entry.grade) && ` (${entry.grade})`)
							),
						h.span.class('text-muted-foreground font-mono text-xs').children(entry.period)
					)
			),
			h.div
				.class('flex flex-wrap gap-x-6 gap-y-1 py-3')
				.children(
					Array.map(languages, lang =>
						h.span
							.key(lang.language)
							.class('text-sm')
							.children(
								h.span.class('font-medium').children(lang.language),
								h.span.class('text-muted-foreground ml-2 font-mono text-xs').children(lang.level)
							)
					)
				)
		])
	)
}

function ContactSection<M>(h: Html.H<M>) {
	return Section(
		h,
		'contact',
		SectionBody(
			h,
			'contact',
			Array.map(contactRows, item =>
				h.a
					.key(item.label)
					.attrs({
						href: item.href,
						...Boolean.match(String.startsWith('/')(item.href), {
							onFalse: () => ({rel: 'noopener noreferrer', target: '_blank'}),
							onTrue: Function.constant({})
						})
					})
					.class('hover:text-primary flex h-7 items-center gap-2 text-sm')
					.children(
						Icon(h, item.icon, 'text-primary size-4 shrink-0'),
						h.span.class('text-muted-foreground').children(item.label),
						h.span.class('ml-auto text-right font-mono text-xs break-all').children(item.value)
					)
			)
		),
		'pb-20'
	)
}

export function ReadingSections<M>(h: Html.H<M>) {
	return h.div.class('contents').children(
		ProfileSection(h),
		SkillsSection(h),
		ExperienceSection(h),
		Section(
			h,
			'projects',
			SectionBody(
				h,
				'projects',
				Array.map(projects, project => ProjectRow(h, project))
			)
		),
		EducationSection(h),
		ContactSection(h)
	)
}
