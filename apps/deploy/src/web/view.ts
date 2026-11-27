import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option} from 'effect'

import type {PaneLeaf, RowData} from '@deslop/design/model'
import {Layout, ListDetail, Row, status, styles, webStyle} from '@deslop/design/web'

import type {InventoryItem} from '#contracts'

import type {DeployScreen} from '#screens/deploy.ts'
import {artworkOf} from '#screens/marks.ts'
import {problemText, sheet, workspace} from '#screens/presentation.ts'
import type {Detail, DetailPort, Exposure, Figure, RunAction, WorkspaceDrawing} from '#screens/presentation.ts'
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
		retry?.(button(h), 'click').children('Retry')
	)
}

function Cover<M>(h: Html.H<M>, item: InventoryItem) {
	const art = artworkOf(item)
	return h.span
		.class('deploy-cover')
		.attr('aria-hidden', 'true')
		.children(
			Boolean.match(art.source === undefined, {
				onFalse: () =>
					h.img.attrs({
						alt: '',
						'data-pixel': Boolean.match(art.pixel, {onFalse: Function.constUndefined, onTrue: Function.constant('')}),
						src: art.source
					}),
				onTrue: () => h.span.style(webStyle(styles.line)).children('›_')
			})
		)
}

function WarmSkeleton<M>(h: Html.H<M>) {
	return h.div.attr('aria-hidden', 'true').class('deploy-detail-skeleton')
}

function RunRow<M>(h: Html.H<M>, screen: DeployScreen, item: InventoryItem, row: View.Input<M>, action?: RunAction) {
	return h.div
		.key(item.id)
		.class('deploy-row-wrap')
		.children(
			row,
			action !== undefined &&
				screen.run(button(h, action.disabled), 'click', action.item).attr('aria-label', action.label).children('Run')
		)
}

function Headline<M>(h: Html.H<M>, label: string, dot?: NonNullable<RowData['problem']>['status']) {
	return h.h1
		.style({...webStyle(styles.heading), ...webStyle(styles.titleLine), margin: '0'})
		.children(dot !== undefined && h.span.style({...webStyle(styles.dot), backgroundColor: status[dot]}), label)
}

function Figures<M>(h: Html.H<M>, values: readonly Figure[]) {
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

function Facts<M>(h: Html.H<M>, values: readonly Figure[], ports: readonly DetailPort[], screen: DeployScreen) {
	return [
		h.dl.class('deploy-facts').children(
			Array.map(values, fact => Fact(h, fact.label, fact.value)),
			Array.isReadonlyArrayNonEmpty(ports) &&
				Fact(
					h,
					'Port',
					h.span.children(
						Array.map(ports, port =>
							Option.match(port.expose, {
								onNone: () => h.span.key(port.id).children(port.label, ' '),
								onSome: target =>
									screen
										.expose(button(h, screen.pending), 'click', target)
										.key(port.id)
										.attr('aria-label', port.title)
										.children(port.label)
							})
						)
					)
				)
		)
	]
}

function Site<M>(h: Html.H<M>, site: Exposure) {
	return h.div
		.key(site.id)
		.children(
			Option.match(Option.fromUndefinedOr(site.url), {
				onNone: () => h.span.children(site.label),
				onSome: url => h.a.attrs({href: url, rel: 'noreferrer', target: '_blank', title: url}).children(site.label)
			}),
			site.status !== undefined && h.span.style({color: status[site.status]}).children(` · ${site.line ?? ''}`)
		)
}

function ProcessReading<M>(h: Html.H<M>, process: Detail['processes'][number]) {
	return h.span
		.class('deploy-figures')
		.style(webStyle(styles.line))
		.children(
			h.span
				.class('deploy-process')
				.attr('aria-hidden', 'true')
				.children(h.span.style({width: `${process.proportion}%`})),
			h.span.children(process.value)
		)
}

function Sheet<M>(h: Html.H<M>, screen: DeployScreen) {
	return sheet<PaneLeaf<View.Input<M>>>(
		screen,
		{
			body: (label, content) =>
				h.div.children(h.h2.style({...webStyle(styles.heading), margin: '0'}).children(label), content),
			exposure: (subtitle, content) =>
				screen
					.submit(h.form, 'submit')
					.attr('id', 'deploy-exposure')
					.children(h.p.class('deploy-caption').children(subtitle), content),
			failure: text => h.p.attr('role', 'alert').children(text),
			hostname: value =>
				h.label
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
							.value(value)
							.disabled(screen.pending)
					),
			logs: text => h.pre.class('deploy-logs').attr('tabindex', '0').children(text),
			submit: (label, disabled) => button(h, disabled).attrs({form: 'deploy-exposure', type: 'submit'}).children(label),
			tailnet: url => h.p.children(url)
		},
		screen.dialog
	)
}

export function Workspace<M>(h: Html.H<M>, screen: DeployScreen) {
	if (screen.problem !== undefined) {
		return Layout(h, {
			content: h.div
				.style({padding: '20px'})
				.children(
					h.p.attr('role', 'status').children(problemText(screen, screen.problem.text)),
					screen.problem.signIn === true &&
						!screen.signingIn &&
						screen.authenticate(button(h), 'click').children('Continue with GitHub'),
					screen.problem.back === true && screen.selection.back(button(h), 'click').children('Back to Deploy')
				)
		})
	}
	const draw: WorkspaceDrawing<Html.H<M>, PaneLeaf<View.Input<M>>> = {
		cover: Cover,
		exposure: Site,
		facts: Facts,
		figure: (html, value, _machine, trace) =>
			html.span.class('deploy-figures').style(webStyle(styles.line)).children(trace, html.span.children(value)),
		figures: Figures,
		headline: Headline,
		history: History,
		job: RunRow,
		list: (html, rows) => html.div.key('apps').children(rows),
		notice: Notice,
		process: ProcessReading,
		row: Row,
		sheet: Sheet(h, screen),
		skeleton: WarmSkeleton,
		sparkline: Sparkline,
		subtitle: (html, value) => html.p.class('deploy-caption').children(value)
	}
	return ListDetail(h, workspace(h, screen, draw))
}
