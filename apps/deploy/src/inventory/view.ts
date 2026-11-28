import {Array, Boolean, Function, Number, Option, Order, Predicate, String, pipe} from 'effect'

import type {Selection} from '@deslop/components/model'
import {styles} from '@deslop/components/styles'

import type {DeployScreen} from '#app'
import type {DeployUi, SheetCommon} from '#view'

import {artwork} from './artwork.gen.ts'
import type {InventoryItem, Process} from './contract.ts'
import {workloadName} from './shared.ts'

import {portChoices} from '#exposures/view.ts'
import {MACHINE} from '#machine/screen.ts'
import {load} from '#machine/view.ts'
import {historyChart, historyNotices} from '#metrics/view.ts'

const COVER = {
	alignItems: 'center',
	display: 'flex',
	flexShrink: 0,
	height: 32,
	justifyContent: 'center',
	width: 32
} as const

const appMarks: Readonly<Record<string, string>> = {
	auth: artwork.auth,
	deploy: artwork.deploy,
	gateway: artwork.gateway,
	opm: artwork.opm,
	portfolio: artwork.portfolio,
	scope: artwork.scope,
	stash: artwork.stash,
	trips: artwork.trips
}

const brands = [
	{pattern: /\bt3code\b/u, source: artwork.t3Light},
	{pattern: /\b(?:node|nodejs)(?:-MainThread)?\b/iu, source: artwork.nodejs},
	{pattern: /\bbun(?:\.native)?\b/u, source: artwork.bun},
	{pattern: /\b(?:postgres|postgresql|postmaster)\b/u, source: artwork.postgresql},
	{pattern: /\bredis(?:-server)?\b/u, source: artwork.redis},
	{pattern: /\b(?:docker|dockerd|containerd)\b/u, source: artwork.docker},
	{pattern: /\b(?:vp|vite)\b/u, source: artwork.vite},
	{pattern: /\bturbo\b/u, source: artwork.turborepoIconDark},
	{pattern: /\besbuild\b/u, source: artwork.esbuild},
	{pattern: /\bcloudflared\b/u, source: artwork.cloudflare}
]

function artworkOf(item: InventoryItem) {
	const name = workloadName(item)

	const app = appMarks[Array.headNonEmpty(String.split(name, /[ -]/u))]
	if (app !== undefined) return {pixel: true, source: app}
	const process = pipe(
		item.processes,
		Option.getOrElse(Array.empty<Process>),
		Array.match({
			onEmpty: Function.constant(''),
			onNonEmpty: entries =>
				Array.max(
					entries,
					Order.mapInput(Number.Order, (entry: Process) => entry.memory)
				).name
		})
	)
	return {
		pixel: false,
		source: pipe(
			brands,
			Array.findFirst(candidate => candidate.pattern.test(`${name} ${process}`)),
			Option.map(entry => entry.source),
			Option.getOrUndefined
		)
	}
}

function cover<H, C, S>(host: H, ui: DeployUi<H, C, S>, item: InventoryItem) {
	const art = artworkOf(item)
	return ui.view(host, {decorative: true, style: COVER}, [
		Option.match(Option.fromUndefinedOr(art.source), {
			onNone: () => ui.text(host, styles.line, '›_'),
			onSome: source =>
				ui.image(host, {
					pixel: art.pixel,
					size: Boolean.match(art.pixel, {onFalse: Function.constant(24), onTrue: Function.constant(32)}),
					source
				})
		})
	])
}

function jobRow<H, C, S>(
	host: H,
	screen: DeployScreen,
	job: DeployScreen['list'][number],
	row: C,
	ui: DeployUi<H, C, S>
) {
	return ui.rowWithAction(
		host,
		job.item.id,
		row,
		Boolean.match(screen.admin, {
			onFalse: Function.constUndefined,
			onTrue: () =>
				ui.button(host, {
					description: `Run ${workloadName(job.item)} now`,
					disabled: screen.pending || job.item.running,
					label: 'Run',
					press: (element, event) => screen.run(element, event, job.item)
				})
		})
	)
}

export function listRows<H, C, S>(
	host: H,
	screen: DeployScreen,
	active: Selection['id'],
	wide: boolean,
	ui: DeployUi<H, C, S>
) {
	const apps = Array.map(screen.list, app => {
		const options = {
			active: app.id === active,
			cover: cover(host, ui, app.item),
			item: app,
			select: screen.selection.select
		}
		if (app.job) return jobRow(host, screen, app, ui.row(host, options), ui)
		return ui.row(host, {
			...options,
			trailing: ui.metric(host, {
				leading: Option.getOrUndefined(
					pipe(
						app.readings,
						Option.liftPredicate(values => wide && Array.isReadonlyArrayNonEmpty(values)),
						Option.map(values => ui.sparkline(host, values, screen.now))
					)
				),
				value: app.trailing,
				wide: true
			})
		})
	})
	const rows = [
		...pipe(
			screen.machine,
			Option.fromUndefinedOr,
			Option.map(machine =>
				ui.row(host, {
					active: active === MACHINE,
					item: {id: MACHINE, line: machine.memory, title: machine.name, trailing: machine.cpu},
					select: screen.selection.select,
					trailing: ui.metric(host, {
						leading: Boolean.match(wide, {
							onFalse: Function.constUndefined,
							onTrue: () => ui.sparkline(host, machine.readings, screen.now)
						}),
						value: machine.cpu
					})
				})
			),
			Option.toArray
		),
		...apps
	]
	if (screen.listStatus !== undefined) return [...rows, ui.notice(host, screen.listStatus, screen.retry)]
	if (Array.isReadonlyArrayEmpty(screen.list)) return [...rows, ui.notice(host, 'No apps')]
	return rows
}

function figureRows<H, C, S>(host: H, app: NonNullable<DeployScreen['detail']>, ui: DeployUi<H, C, S>) {
	if (app.scheduled) return []
	return [
		ui.figures(host, [
			{label: 'CPU', value: app.cpu},
			{label: 'Memory', value: app.memory}
		])
	]
}

// An app's detail pane: its name and state, figures, history, facts, sites, processes and jobs.
export function appRows<H, C, S>(
	host: H,
	screen: DeployScreen,
	app: NonNullable<DeployScreen['detail']>,
	ui: DeployUi<H, C, S>
) {
	return [
		ui.headline(host, app.name, app.status),
		...pipe(
			app.subtitle,
			Option.liftPredicate(String.isNonEmpty),
			Option.map(text => ui.caption(host, text)),
			Option.toArray
		),
		...figureRows(host, app, ui),
		...pipe(
			app,
			Option.liftPredicate(detail => detail.charted),
			Option.map(detail => historyChart(host, screen, ui, detail.readings, detail.restarts)),
			Option.toArray
		),
		...historyNotices(host, screen, ui),
		...ui.facts(host, {
			choices: portChoices(screen, app),
			values: [...app.facts, ...load(`${screen.machine?.name ?? 'Machine'} load (1m / 5m / 15m)`, screen.load)]
		}),
		...Array.map(app.exposures, site =>
			ui.site(host, site, url => (element, event) => screen.openUrl(element, event, url))
		),
		...Array.map(app.processes, process =>
			ui.row(host, {
				active: false,
				item: {id: process.key, line: process.line ?? '', title: process.label, trailing: process.value},
				trailing: ui.metric(host, {leading: ui.bar(host, process.proportion), value: process.value})
			})
		),
		...Array.map(app.jobs, job =>
			jobRow(
				host,
				screen,
				job,
				ui.row(host, {active: false, cover: cover(host, ui, job.item), item: job, select: screen.selection.select}),
				ui
			)
		)
	]
}

// The sheet that shows an app's logs or why an action failed.
export function actionSheet<H, C, S>(
	host: H,
	ui: DeployUi<H, C, S>,
	dialog: Exclude<NonNullable<DeployScreen['dialog']>, {readonly _tag: 'Expose'}>,
	common: SheetCommon<C>
) {
	return {
		...common,
		actions: ui.view(host, {}, []),
		body: ui.section(
			host,
			dialog.label,
			pipe(
				dialog,
				Predicate.isTagged('Logs'),
				Boolean.match({onFalse: () => ui.paragraph(host, dialog.text, true), onTrue: () => ui.logs(host, dialog.text)})
			)
		),
		height: pipe(
			dialog,
			Predicate.isTagged('Logs'),
			Boolean.match({onFalse: Function.constant(ui.regularSheetHeight), onTrue: Function.constant(0.72)})
		)
	}
}
