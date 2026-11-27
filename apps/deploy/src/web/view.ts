import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Option, String, pipe} from 'effect'

import type {SheetOptions} from '@deslop/design/model'
import {Layout, ListDetail, Row, status, styles, webStyle} from '@deslop/design/web'

import {workloadName} from '#contracts'
import type {InventoryItem} from '#contracts'

import {MACHINE} from '#screens/deploy.ts'
import type {DeployScreen} from '#screens/deploy.ts'
import {artworkOf} from '#screens/marks.ts'
import {History, Sparkline} from '#web/chart.ts'

function button<M>(h: Html.H<M>, disabled = false) {
	return h.button
		.class('design-control deploy-control')
		.attr('type', 'button')
		.disabled(disabled)
		.style(webStyle(styles.control))
}

function Notice<M>(h: Html.H<M>, text: string, retry?: DeployScreen['retry']) {
	return h.div.style({padding: '8px 12px'}).children(
		h.p
			.attr('role', 'status')
			.style({...webStyle(styles.line), margin: '0'})
			.children(text),
		retry !== undefined && retry(button(h), 'click').children('Retry')
	)
}

function Cover<M>(h: Html.H<M>, item: InventoryItem) {
	const art = artworkOf(item)
	return h.span
		.class('deploy-cover')
		.attr('aria-hidden', 'true')
		.children(
			art.source === undefined
				? h.span.style(webStyle(styles.line)).children('›_')
				: h.img.attrs({alt: '', 'data-pixel': art.pixel ? '' : undefined, src: art.source})
		)
}

function WarmSkeleton<M>(h: Html.H<M>) {
	return h.div.attr('aria-hidden', 'true').class('deploy-detail-skeleton')
}

function RunRow<M>(h: Html.H<M>, screen: DeployScreen, item: InventoryItem, row: View.Input<M>) {
	return h.div
		.key(item.id)
		.class('deploy-row-wrap')
		.children(
			row,
			screen.admin &&
				screen
					.run(button(h, screen.pending || item.running), 'click', item)
					.attr('aria-label', `Run ${workloadName(item)} now`)
					.children('Run')
		)
}

function rows<M>(h: Html.H<M>, screen: DeployScreen, active: string | undefined, wide: boolean) {
	const machine = screen.machine
	return [
		machine !== undefined &&
			Row(h, {
				active: active === MACHINE,
				item: {id: MACHINE, line: machine.memory, title: machine.name, trailing: machine.cpu},
				select: screen.selection.select,
				trailing: h.span
					.class('deploy-figures')
					.style(webStyle(styles.line))
					.children(wide && Sparkline(h, machine.readings, screen.now), h.span.children(machine.cpu))
			}),
		...Array.map(screen.list, app => {
			const row = Row(h, {
				active: active === app.id,
				cover: Cover(h, app.item),
				item: app,
				select: screen.selection.select,
				trailing: app.job
					? undefined
					: h.span
							.class('deploy-figures')
							.style(webStyle(styles.line))
							.children(
								wide && Array.isReadonlyArrayNonEmpty(app.readings) && Sparkline(h, app.readings, screen.now),
								h.span.children(app.trailing)
							)
			})
			return app.job ? RunRow(h, screen, app.item, row) : row
		}),
		screen.listStatus !== undefined && Notice(h, screen.listStatus, screen.retry),
		screen.listStatus === undefined && Array.isReadonlyArrayEmpty(screen.list) && Notice(h, 'No apps')
	]
}

function Headline<M>(h: Html.H<M>, label: string, dot?: keyof typeof status) {
	return h.h1
		.style({...webStyle(styles.heading), ...webStyle(styles.titleLine), margin: '0'})
		.children(dot !== undefined && h.span.style({...webStyle(styles.dot), backgroundColor: status[dot]}), label)
}

function Figures<M>(h: Html.H<M>, values: readonly {label: string; value: string}[]) {
	return h.div
		.class('deploy-plot-data')
		.children(
			Array.map(values, item =>
				h.div
					.key(item.label)
					.children(h.strong.children(item.value), h.span.class('deploy-caption').children(item.label))
			)
		)
}

function Fact<M>(h: Html.H<M>, label: string, value: View.Input<M>) {
	return h.div.key(label).children(h.dt.class('deploy-caption').children(label), h.dd.children(value))
}

function HistoryStatus<M>(h: Html.H<M>, screen: DeployScreen) {
	const history = screen.historyStatus
	return history !== undefined && Notice(h, history.text, history.retry ? screen.retry : undefined)
}

function Overview<M>(h: Html.H<M>, screen: DeployScreen) {
	const machine = screen.machine
	if (machine === undefined) return undefined
	return [
		Headline(h, machine.name),
		Figures(h, [
			{label: 'CPU', value: machine.cpu},
			{label: 'Memory', value: machine.memory},
			{label: 'Disk', value: machine.disk}
		]),
		screen.historyLoading ? WarmSkeleton(h) : History(h, machine.readings, [], screen.now),
		HistoryStatus(h, screen),
		h.dl
			.class('deploy-facts')
			.children(
				Fact(h, 'Peak, mean', machine.peak),
				screen.load !== undefined && Fact(h, 'Load (1m / 5m / 15m)', screen.load)
			)
	]
}

function Detail<M>(h: Html.H<M>, screen: DeployScreen) {
	if (screen.loading) return WarmSkeleton(h)
	if (screen.inventoryFailed) return Notice(h, 'Couldn’t load apps', screen.retry)
	if (screen.machineSelected) return Overview(h, screen)
	const app = screen.detail
	if (app === undefined) {
		if (screen.missing) return Notice(h, 'App not found')
		return Overview(h, screen)
	}
	return [
		Headline(h, app.name, app.status),
		String.isNonEmpty(app.subtitle) && h.p.class('deploy-caption').children(app.subtitle),
		!app.scheduled &&
			Figures(h, [
				{label: 'CPU', value: app.cpu},
				{label: 'Memory', value: app.memory}
			]),
		app.charted && (screen.historyLoading ? WarmSkeleton(h) : History(h, app.readings, app.restarts, screen.now)),
		HistoryStatus(h, screen),
		h.dl.class('deploy-facts').children(
			Array.map(app.facts, fact => Fact(h, fact.label, fact.value)),
			screen.load !== undefined && Fact(h, `${screen.machine?.name ?? 'Machine'} load (1m / 5m / 15m)`, screen.load),
			Array.isArrayNonEmpty(app.ports) &&
				Fact(
					h,
					'Port',
					h.span.children(
						Array.map(app.ports, port =>
							pipe(
								port.target,
								Option.match({
									onNone: () => h.span.key(port.id).children(port.label, ' '),
									onSome: target =>
										screen.admin
											? screen
													.expose(button(h, screen.pending), 'click', target)
													.key(port.id)
													.attr('aria-label', `Expose ${app.name} ${port.label}`)
													.children(port.label)
											: h.span.key(port.id).children(port.label, ' ')
								})
							)
						)
					)
				)
		),
		...Array.map(app.exposures, site =>
			h.div
				.key(site.id)
				.children(
					site.url === undefined
						? h.span.children(site.label)
						: h.a.attrs({href: site.url, rel: 'noreferrer', target: '_blank', title: site.url}).children(site.label),
					site.status !== undefined && h.span.style({color: status[site.status]}).children(` · ${site.line ?? ''}`)
				)
		),
		...Array.map(app.processes, process =>
			Row(h, {
				active: false,
				item: {id: process.key, line: process.line ?? '', title: process.label, trailing: process.value},
				trailing: h.span
					.class('deploy-figures')
					.style(webStyle(styles.line))
					.children(
						h.span
							.class('deploy-process')
							.attr('aria-hidden', 'true')
							.children(h.span.style({width: `${process.proportion}%`})),
						h.span.children(process.value)
					)
			})
		),
		...Array.map(app.jobs, job =>
			RunRow(
				h,
				screen,
				job.item,
				Row(h, {active: false, cover: Cover(h, job.item), item: job, select: screen.selection.select})
			)
		)
	]
}

function Sheet<M>(h: Html.H<M>, screen: DeployScreen): SheetOptions<View.Input<M>> | undefined {
	const dialog = screen.dialog
	if (dialog === undefined) return undefined
	const expose = dialog._tag === 'Expose'
	const logs = dialog._tag === 'Logs'
	return {
		body: h.div.children(
			h.h2.style({...webStyle(styles.heading), margin: '0'}).children(dialog.label),
			expose
				? screen
						.submit(h.form, 'submit')
						.attr('id', 'deploy-exposure')
						.children(
							h.p.class('deploy-caption').children(dialog.subtitle),
							dialog.kind === 'tailnet'
								? h.p.children(dialog.text)
								: h.label
										.style(webStyle(styles.body))
										.children(
											'Hostname',
											screen
												.hostname(h.input, 'input')
												.class('deploy-input')
												.attrs({
													autocapitalize: 'none',
													autocomplete: 'off',
													placeholder: 'app.example.com',
													spellcheck: 'false',
													type: 'text'
												})
												.value(dialog.hostname)
												.disabled(screen.pending)
										)
						)
				: logs
					? h.pre.class('deploy-logs').attr('tabindex', '0').children(dialog.text)
					: h.p.attr('role', 'alert').children(dialog.text)
		),
		actions:
			expose &&
			button(h, dialog.disabled)
				.attrs({type: 'submit', form: 'deploy-exposure'})
				.children(screen.pending ? 'Exposing…' : 'Expose'),
		dismiss: screen.dismiss,
		height: logs ? 0.72 : undefined,
		label: dialog.label,
		open: true,
		pending: dialog.pending,
		toolbar: {actions: dialog.toolbar, choose: screen.choose}
	}
}

export function Workspace<M>(h: Html.H<M>, screen: DeployScreen) {
	const problem = screen.problem
	if (problem !== undefined)
		return Layout(h, {
			content: h.div
				.style({padding: '20px'})
				.children(
					h.p.attr('role', 'status').children(screen.signingIn ? 'Signing in…' : problem.text),
					problem.signIn === true &&
						!screen.signingIn &&
						screen.authenticate(button(h), 'click').children('Continue with GitHub'),
					problem.back === true && screen.selection.back(button(h), 'click').children('Back to Deploy')
				)
		})
	return ListDetail(h, {
		defaultId: screen.id,
		detail: Detail(h, screen),
		detailToolbar: screen.actions,
		list: (active, wide) => h.div.key('apps').children(rows(h, screen, active, wide)),
		loading: screen.loading,
		selection: screen.selection,
		sheet: Sheet(h, screen),
		toolbar: {actions: [], choose: screen.choose}
	})
}
