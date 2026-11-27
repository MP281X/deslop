import {Component, UiSchema} from '@effect/ui'
import type {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Match, Predicate, Schema, pipe} from 'effect'

import type {ToolbarOptions} from '@deslop/design/model'
import {Layout} from '@deslop/design/native'

import {appOrigin} from '#iphone/origin.ts'
import {CvScreen, ProfileScreen} from '#screens/portfolio.ts'
import {PortfolioRoute} from '#screens/routes.ts'

const PAPER = '#0d0c0c'
const INK = '#e3e1db'
const MUTED = '#a19e96'
const CORAL = '#fd7357'
const BORDER = '#262523'
const MONO = 'Menlo'

export const Message = UiSchema.TaggedEnum({
	OpenedLink: {url: Schema.String},
	Routed: {route: PortfolioRoute},
	ShowCv: {},
	ShowProfile: {}
})

type H = Native.H<typeof Message.Type>
type Body = Native.NoTextInput<typeof Message.Type>

const CvActions = Component.define({events: Message, message: Message, model: Schema.Void, name: 'CvActions'}).make({
	init: Function.constUndefined,
	parts: p => ({
		choose: p.part((el, event: string, identify: Parameters<ToolbarOptions['choose']>[2]) =>
			el.on(event, payload =>
				pipe(
					Match.value(identify(payload)),
					Match.when('home', () => Message.ShowProfile()),
					Match.when('print', () => Message.OpenedLink({url: `${appOrigin}${ProfileScreen.cvPath}`})),
					Match.orElse(Function.constUndefined)
				)
			)
		)
	}),
	update: ($, message) => $.set(undefined).emit(message)
})

const styles = {
	body: {color: INK, fontSize: 14, lineHeight: 21},
	card: {backgroundColor: PAPER, borderColor: BORDER, borderWidth: 1, padding: 16},
	cvBody: {color: INK, fontSize: 14, lineHeight: 20},
	cvHeading: {color: INK, fontFamily: MONO, fontSize: 13, fontWeight: '700', letterSpacing: 1.8},
	meta: {color: MUTED, fontFamily: MONO, fontSize: 12, lineHeight: 18},
	row: {gap: 4, paddingVertical: 10},
	title: {color: INK, fontSize: 15, fontWeight: '600'}
} as const satisfies Readonly<Record<string, Native.TextStyle>>

function Link(h: H, label: string, message: typeof Message.Type, body: Body) {
	return Pressable(h, {onPress: message, props: {pressedStyle: {backgroundColor: BORDER}}})
		.on('accessibilityTap', message)
		.prop('accessible', true)
		.prop('accessibilityRole', 'link')
		.prop('accessibilityLabel', label)
		.style({justifyContent: 'center', minHeight: 44})
		.children(body)
}

function Panel(h: H, ...body: Body[]) {
	return h.view.style(styles.card).children(...body)
}

function BulletList(h: H, items: readonly string[]) {
	return h.view.style({gap: 3}).children(
		Array.map(items, item =>
			h.view
				.key(item)
				.style({alignItems: 'flex-start', flexDirection: 'row', gap: 8})
				.children(
					h.view.style({backgroundColor: MUTED, height: 4, marginTop: 8, width: 4}),
					h.text.style({...styles.body, flex: 1}).children(item)
				)
		)
	)
}

function Column(h: H, id: string, ...body: Body[]) {
	return h.scroll
		.key(id)
		.prop('contentInsetAdjustmentBehavior', 'automatic')
		.style({backgroundColor: PAPER, flex: 1})
		.contentContainerStyle({paddingBottom: 32, paddingLeft: 16, paddingRight: 76, paddingTop: 20})
		.children(h.view.style({alignSelf: 'center', gap: 20, maxWidth: 768, width: '100%'}).children(...body))
}

function ProfileHeading(h: H) {
	return h.view
		.style({...styles.card, gap: 12, marginTop: 16, paddingVertical: 24})
		.children(
			h.text
				.prop('accessibilityRole', 'header')
				.style({color: INK, fontSize: 36, fontWeight: '600', letterSpacing: -1.2, lineHeight: 40})
				.children(ProfileScreen.name),
			h.text.style({...styles.meta, color: CORAL, fontSize: 13}).children(ProfileScreen.profile.title),
			h.text.style({...styles.body, fontSize: 16, lineHeight: 24}).children(ProfileScreen.summary),
			h.text.style(styles.meta).children(ProfileScreen.profile.location)
		)
}

function ProfileSkills(h: H) {
	return Panel(
		h,
		Array.map(ProfileScreen.skills, skill =>
			h.view
				.key(skill.area)
				.style(styles.row)
				.children(h.text.style(styles.title).children(skill.area), h.text.style(styles.body).children(skill.items))
		)
	)
}

function ProfileExperience(h: H) {
	return Panel(
		h,
		Array.map(ProfileScreen.experience, job =>
			h.view
				.key(job.company)
				.style(styles.row)
				.children(
					h.text.style(styles.title).children(job.company),
					h.text
						.style({...styles.body, color: MUTED})
						.children(pipe([job.role, job.note], Array.filter(Predicate.isNotUndefined), Array.join(' · '))),
					h.text
						.style(styles.meta)
						.children(pipe([job.period, job.location], Array.filter(Predicate.isNotUndefined), Array.join(' · '))),
					BulletList(h, job.highlights)
				)
		)
	)
}

function ProfileProjects(h: H) {
	return Panel(
		h,
		Array.map(ProfileScreen.projects, project =>
			h.view
				.key(project.name)
				.style(styles.row)
				.children(
					Link(
						h,
						`View ${project.name} on GitHub`,
						Message.OpenedLink({url: project.href}),
						h.view
							.style({alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'})
							.children(
								h.view
									.style({flex: 1})
									.children(
										h.text.style(styles.title).children(project.name),
										h.text.style({...styles.body, color: MUTED}).children(project.role)
									),
								h.text.style({...styles.title, color: CORAL}).children('↗')
							)
					),
					h.text.style(styles.body).children(project.description),
					h.text.style(styles.meta).children(project.stack)
				)
		)
	)
}

function ProfileEducation(h: H) {
	return Panel(
		h,
		Array.map(ProfileScreen.education, entry =>
			h.view
				.key(entry.school)
				.style(styles.row)
				.children(
					h.text.style(styles.title).children(entry.school),
					h.text.style(styles.body).children(entry.degree, ` (${entry.grade})`),
					h.text.style(styles.meta).children(entry.period)
				)
		),
		h.view
			.style({columnGap: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 4})
			.children(
				Array.map(ProfileScreen.languages, entry =>
					h.text.key(entry.language).style(styles.meta).children(`${entry.language} ${entry.level}`)
				)
			)
	)
}

function ProfileContacts(h: H) {
	return Panel(
		h,
		Array.map(ProfileScreen.contactRows, item =>
			h.view
				.key(item.label)
				.children(
					Link(
						h,
						`${item.label}, ${item.value}`,
						Boolean.match(item.href === ProfileScreen.cvPath, {
							onFalse: () => Message.OpenedLink({url: item.href}),
							onTrue: () => Message.ShowCv()
						}),
						h.view
							.style({alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between'})
							.children(
								h.text.style({...styles.body, color: MUTED}).children(item.label),
								h.text.style({...styles.meta, color: CORAL, flexShrink: 1, textAlign: 'right'}).children(item.value)
							)
					)
				)
		)
	)
}

export function Profile(h: Native.H<typeof Message.Type>) {
	return Layout(h, {
		content: Column(
			h,
			'profile',
			ProfileHeading(h),
			ProfileSkills(h),
			ProfileExperience(h),
			ProfileProjects(h),
			ProfileEducation(h),
			ProfileContacts(h),
			h.text.style(styles.meta).children(`© 2026 · VAT ${ProfileScreen.profile.vat}`)
		)
	})
}

function CvGrid(h: H) {
	const line = {backgroundColor: '#ffffff', position: 'absolute'} as const
	return h.view
		.style({
			bottom: 0,
			left: 0,
			opacity: 0.07,
			overflow: 'hidden',
			pointerEvents: 'none',
			position: 'absolute',
			right: 0,
			top: 0
		})
		.children(
			Array.makeBy(31, column =>
				h.view.key(`column-${column}`).style({...line, bottom: 0, left: column * 26, top: 0, width: 1})
			),
			Array.makeBy(20, row => h.view.key(`row-${row}`).style({...line, height: 1, left: 0, right: 0, top: row * 26}))
		)
}

function CvHeading(h: H) {
	return h.view.style({borderBottomColor: INK, borderBottomWidth: 2, gap: 12, paddingBottom: 12}).children(
		CvGrid(h),
		h.text
			.prop('accessibilityRole', 'header')
			.style({...styles.cvHeading, fontSize: 26, letterSpacing: 3, textTransform: 'uppercase'})
			.children(CvScreen.profile.firstName),
		h.text
			.style({...styles.cvHeading, color: MUTED, fontSize: 20, textTransform: 'uppercase'})
			.children(CvScreen.profile.lastName),
		h.text.style({...styles.cvHeading, textTransform: 'uppercase'}).children(CvScreen.profile.title),
		h.text.style(styles.cvBody).children(CvScreen.summary),
		h.view.style({columnGap: 14, flexDirection: 'row', flexWrap: 'wrap'}).children(
			h.text.style({...styles.meta, alignSelf: 'center'}).children(CvScreen.profile.location),
			Array.map(
				[
					CvScreen.contacts.phone,
					CvScreen.contacts.email,
					CvScreen.contacts.github,
					{...CvScreen.contacts.pec, value: `PEC ${CvScreen.contacts.pec.value}`},
					CvScreen.website
				],
				link =>
					h.view
						.key(link.href)
						.children(
							Link(h, link.value, Message.OpenedLink({url: link.href}), h.text.style(styles.meta).children(link.value))
						)
			),
			h.text.style({...styles.meta, alignSelf: 'center'}).children(`VAT ${CvScreen.profile.vat}`)
		)
	)
}

function CvSection(h: H, name: string, body: Body) {
	return h.view
		.style({gap: 8})
		.children(h.text.prop('accessibilityRole', 'header').style(styles.cvHeading).children(name), body)
}

function CvEntry(h: H, input: {aside: string; details: readonly string[]; title: string}, body?: Body) {
	return h.view
		.key(input.title)
		.style({gap: 4, paddingBottom: 8})
		.children(
			h.text
				.style(styles.cvBody)
				.children(
					h.text.style({fontWeight: '600'}).children(input.title),
					h.text.style({color: MUTED}).children(` · ${Array.join(input.details, ' · ')}`)
				),
			h.text.style(styles.meta).children(input.aside),
			body
		)
}

export function Cv(h: Native.H<typeof Message.Type>) {
	return CvActions(h, {
		onEmit: message => message,
		view: actions =>
			Layout(h, {
				content: Column(
					h,
					'cv',
					CvHeading(h),
					CvSection(
						h,
						'TECHNICAL SKILLS',
						Array.map(CvScreen.skills, skill =>
							h.text
								.key(skill.area)
								.style(styles.cvBody)
								.children(h.text.style({fontWeight: '600'}).children(`${skill.area}: `), skill.items)
						)
					),
					CvSection(
						h,
						'WORK EXPERIENCE',
						Array.map(CvScreen.experience, job => CvEntry(h, job, BulletList(h, job.highlights)))
					),
					CvSection(
						h,
						'PROJECTS',
						Array.map(CvScreen.projects, project =>
							CvEntry(h, project, h.text.style(styles.cvBody).children(project.description))
						)
					),
					CvSection(h, 'EDUCATION & LANGUAGES', [
						...Array.map(CvScreen.education, entry => CvEntry(h, entry)),
						h.text.style(styles.cvBody).children(`Languages: ${CvScreen.languages}`)
					])
				),
				toolbar: {
					actions: [
						{id: 'home', label: 'Portfolio', symbol: 'chevron.left'},
						{id: 'print', label: 'Open printable CV', symbol: 'doc.text'}
					],
					choose: actions.choose
				}
			})
	})
}
