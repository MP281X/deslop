import {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Function, Option, String} from 'effect'

import type {SheetOptions} from '@deslop/design/model'
import {Layout, ListDetail, Row, black, fold, ink, status, styles} from '@deslop/design/native'

import {workloadName} from '#contracts'
import type {InventoryItem} from '#contracts'

import {History, Sparkline} from '#iphone/chart.ts'
import {MACHINE} from '#screens/deploy.ts'
import type {DeployScreen} from '#screens/deploy.ts'
import {artworkOf} from '#screens/marks.ts'

const FIGURES = ['tabular-nums'] as const
const Image: <M>() => Native.ViewElement<M, never, Record<string, unknown>, 'deployImage'> = Function.constant(
	Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, 'deployImage'>('deployImage'), {
		viewName: 'RCTImageView'
	})
)

function Button<M>(
	h: Native.H<M>,
	el: Native.ViewElement<M, never, Native.ViewEvents, 'view'>,
	label: string,
	disabled = false
) {
	return Pressable(h, {element: el, props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.style({...styles.control, opacity: disabled ? 0.45 : 1})
		.prop('accessibilityRole', 'button')
		.prop('accessibilityState', {disabled})
		.prop('accessible', true)
		.children(h.text.style(styles.body).children(label))
}

function Notice<M>(h: Native.H<M>, text: string, retry?: DeployScreen['retry']) {
	return h.view
		.style({paddingHorizontal: 12, alignItems: 'flex-start', paddingVertical: 8})
		.children(
			h.text.style(styles.line).children(text),
			retry !== undefined && Button(h, retry(retry(h.view, 'press'), 'accessibilityTap'), 'Retry')
		)
}

function Cover<M>(h: Native.H<M>, item: InventoryItem) {
	const art = artworkOf(item)
	const size = art.pixel ? 32 : 24
	return h.view.style({width: 32, height: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center'}).children(
		art.source === undefined
			? h.text.style(styles.line).children('›_')
			: Image<M>()
					.style({width: size, height: size})
					.prop('resizeMode', 'contain')
					.prop('source', [{uri: art.source, width: size, height: size, scale: 1}])
	)
}

function WarmSkeleton<M>(h: Native.H<M>) {
	return h.view
		.style({gap: 12})
		.children(
			h.view.style({backgroundColor: '#202020', borderRadius: 4, width: '38%', height: 20}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, width: '65%', height: 14}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, width: '92%', height: 96})
		)
}

function RunRow<M>(h: Native.H<M>, screen: DeployScreen, item: InventoryItem, row: Native.NoTextInput<M>) {
	return h.view
		.key(item.id)
		.style({flexDirection: 'row', gap: 4, alignItems: 'center'})
		.children(
			h.view.style({flex: 1}).children(row),
			screen.admin &&
				Button(
					h,
					screen
						.run(screen.run(h.view, 'press', item), 'accessibilityTap', item)
						.prop('accessibilityLabel', `Run ${workloadName(item)} now`),
					'Run',
					screen.pending || item.running
				)
		)
}

function rows<M>(h: Native.H<M>, screen: DeployScreen, active: string | undefined, wide: boolean) {
	const machine = screen.machine
	return [
		machine !== undefined &&
			Row(h, {
				active: active === MACHINE,
				item: {id: MACHINE, line: machine.memory, title: machine.name, trailing: machine.cpu},
				select: screen.selection.select,
				trailing: h.view
					.style({flexDirection: 'row', alignItems: 'center', gap: 8})
					.children(
						wide && Sparkline(h, machine.readings, screen.now),
						h.text.style({...styles.line, fontVariant: FIGURES}).children(machine.cpu)
					)
			}),
		...Array.map(screen.list, app => {
			const row = Row(h, {
				active: active === app.id,
				cover: Cover(h, app.item),
				item: app,
				select: screen.selection.select,
				trailing: app.job
					? undefined
					: h.view
							.style({flexDirection: 'row', alignItems: 'center', gap: 8})
							.children(
								wide && Array.isReadonlyArrayNonEmpty(app.readings) && Sparkline(h, app.readings, screen.now),
								h.text
									.style({...styles.line, minWidth: 92, textAlign: 'right', fontVariant: FIGURES})
									.children(app.trailing)
							)
			})
			return app.job ? RunRow(h, screen, app.item, row) : row
		}),
		screen.listStatus !== undefined && Notice(h, screen.listStatus, screen.retry),
		screen.listStatus === undefined && Array.isReadonlyArrayEmpty(screen.list) && Notice(h, 'No apps')
	]
}

function Headline<M>(h: Native.H<M>, label: string, dot?: keyof typeof status) {
	return h.view.style(styles.titleLine).children(
		dot !== undefined && h.view.style({...styles.dot, backgroundColor: status[dot]}),
		h.text
			.style({...styles.heading, flexShrink: 1})
			.prop('accessibilityRole', 'header')
			.children(label)
	)
}

function Figures<M>(h: Native.H<M>, values: readonly {label: string; value: string}[]) {
	return h.view
		.style({flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8})
		.children(
			Array.map(values, item =>
				h.view
					.key(item.label)
					.children(
						h.text.style({...styles.heading, fontSize: 19, fontVariant: FIGURES}).children(item.value),
						h.text.style(styles.line).children(item.label)
					)
			)
		)
}

function Fact<M>(h: Native.H<M>, label: string, value: string) {
	return h.view
		.key(label)
		.style({flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8})
		.children(
			h.text.style(styles.line).children(label),
			h.text
				.style({...styles.line, flexShrink: 1, color: ink, textAlign: 'right', fontVariant: FIGURES})
				.children(value)
		)
}

function HistoryStatus<M>(h: Native.H<M>, screen: DeployScreen) {
	const history = screen.historyStatus
	return history !== undefined && Notice(h, history.text, history.retry ? screen.retry : undefined)
}

function Overview<M>(h: Native.H<M>, screen: DeployScreen) {
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
		Fact(h, 'Peak, mean', machine.peak),
		screen.load !== undefined && Fact(h, 'Load (1m / 5m / 15m)', screen.load)
	]
}

function Detail<M>(h: Native.H<M>, screen: DeployScreen) {
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
		String.isNonEmpty(app.subtitle) && h.text.style(styles.line).children(app.subtitle),
		!app.scheduled &&
			Figures(h, [
				{label: 'CPU', value: app.cpu},
				{label: 'Memory', value: app.memory}
			]),
		app.charted && (screen.historyLoading ? WarmSkeleton(h) : History(h, app.readings, app.restarts, screen.now)),
		HistoryStatus(h, screen),
		...Array.map(app.facts, fact => Fact(h, fact.label, fact.value)),
		screen.load !== undefined && Fact(h, `${screen.machine?.name ?? 'Machine'} load (1m / 5m / 15m)`, screen.load),
		Array.isArrayNonEmpty(app.ports) &&
			h.view.style({flexDirection: 'row', alignItems: 'center', gap: 8}).children(
				h.text.style(styles.line).children('Port'),
				h.view
					.style({
						flex: 1,
						flexDirection: 'row',
						flexWrap: 'wrap',
						justifyContent: 'flex-end',
						alignItems: 'center',
						gap: 4
					})
					.children(
						Array.map(app.ports, port => {
							if (Option.isNone(port.target) || !screen.admin) {
								return h.text.key(port.id).style(styles.body).children(port.label)
							}
							const target = port.target.value
							return Button(
								h,
								screen
									.expose(screen.expose(h.view, 'press', target), 'accessibilityTap', target)
									.key(port.id)
									.prop('accessibilityLabel', `Expose ${app.name} ${port.label}`),
								port.label,
								screen.pending
							)
						})
					)
			),
		...Array.map(app.exposures, site => {
			const url = site.url
			return h.view
				.key(site.id)
				.style(styles.titleLine)
				.children(
					site.status !== undefined && h.view.style({...styles.dot, backgroundColor: status[site.status]}),
					url === undefined
						? h.text.style(styles.body).children(site.label)
						: Button(h, screen.openUrl(screen.openUrl(h.view, 'press', url), 'accessibilityTap', url), site.label),
					site.line !== undefined && h.text.style({...styles.line, flexShrink: 1}).children(site.line)
				)
		}),
		...Array.map(app.processes, process =>
			Row(h, {
				active: false,
				item: {id: process.key, line: process.line ?? '', title: process.label, trailing: process.value},
				trailing: h.view
					.style({flexDirection: 'row', alignItems: 'center', gap: 8})
					.children(
						h.view
							.style({width: 40, height: 4, borderRadius: 2, backgroundColor: fold})
							.children(
								h.view.style({
									width: `${process.proportion}%`,
									height: 4,
									borderRadius: 2,
									backgroundColor: styles.line.color
								})
							),
						h.text.style({...styles.line, fontVariant: FIGURES}).children(process.value)
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

function Sheet<M>(h: Native.H<M>, screen: DeployScreen): SheetOptions<Native.NoTextInput<M>> | undefined {
	const dialog = screen.dialog
	if (dialog === undefined) return undefined
	const expose = dialog._tag === 'Expose'
	const logs = dialog._tag === 'Logs'
	return {
		actions:
			expose &&
			Button(
				h,
				screen.submit(screen.submit(h.view, 'press'), 'accessibilityTap'),
				screen.pending ? 'Exposing…' : 'Expose',
				dialog.disabled
			),
		body: h.view.style({gap: 8}).children(
			h.text.style(styles.heading).children(dialog.label),
			expose
				? h.view.style({gap: 8}).children(
						h.text.style(styles.line).children(dialog.subtitle),
						dialog.kind === 'tailnet'
							? h.text.style(styles.body).children(dialog.text)
							: h.view.children(
									h.text.style(styles.body).children('Hostname'),
									screen
										.hostname(h.input, 'input')
										.style({
											...styles.body,
											borderWidth: 1,
											borderColor: fold,
											borderRadius: 8,
											minHeight: 40,
											padding: 8
										})
										.prop('accessibilityLabel', 'Hostname')
										.prop('autoCapitalize', 'none')
										.prop('autoCorrect', false)
										.prop('editable', !screen.pending)
										.placeholder('app.example.com')
										.value(dialog.hostname)
								)
					)
				: h.text
						.style(logs ? {...styles.body, fontFamily: 'ui-monospace', fontSize: 12, lineHeight: 17} : styles.body)
						.children(dialog.text)
		),
		dismiss: screen.dismiss,
		height: logs ? 0.72 : 0.58,
		label: dialog.label,
		open: true,
		pending: dialog.pending,
		toolbar: {actions: dialog.toolbar, choose: screen.choose}
	}
}

export function Workspace<M>(h: Native.H<M>, screen: DeployScreen) {
	const problem = screen.problem
	if (problem !== undefined)
		return Layout(h, {
			content: h.view
				.style({
					flex: 1,
					justifyContent: 'center',
					alignItems: 'flex-start',
					padding: 20,
					gap: 8,
					backgroundColor: black
				})
				.children(
					h.text.style(styles.body).children(screen.signingIn ? 'Signing in…' : problem.text),
					problem.signIn === true &&
						!screen.signingIn &&
						Button(
							h,
							screen.authenticate(screen.authenticate(h.view, 'press'), 'accessibilityTap'),
							'Continue with GitHub'
						),
					problem.back === true &&
						Button(
							h,
							screen.selection.back(screen.selection.back(h.view, 'press'), 'accessibilityTap'),
							'Back to Deploy'
						)
				)
		})
	return ListDetail(h, {
		defaultId: screen.id,
		detail: Detail(h, screen),
		detailToolbar: screen.actions,
		list: (active, wide) => h.view.key('apps').children(rows(h, screen, active, wide)),
		loading: screen.loading,
		selection: screen.selection,
		sheet: Sheet(h, screen),
		toolbar: {actions: [], choose: screen.choose}
	})
}
