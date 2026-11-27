import {Array, Boolean, Function, Option, Predicate, String, pipe} from 'effect'
import type {DateTime} from 'effect'

import type {ListOptions, RowData, RowOptions, Selection, SheetOptions} from '@deslop/design/model'

import {workloadName} from '#contracts'
import type {InventoryItem} from '#contracts'

import type {Reading} from '#screens/chart.ts'
import {MACHINE} from '#screens/deploy.ts'
import type {DeployScreen} from '#screens/deploy.ts'

export type RunAction = {disabled: boolean; item: InventoryItem; label: string}
export type Figure = {label: string; value: string}
export type Detail = NonNullable<DeployScreen['detail']>
export type Exposure = Detail['exposures'][number]
export type DetailPort = {expose: Option.Option<InventoryItem>; id: string; label: string; title: string}

export type WorkspaceDrawing<H, C> = Pick<ListOptions<C>, 'sheet'> & {
	cover: (host: H, item: InventoryItem) => C
	exposure: (host: H, site: Exposure, screen: DeployScreen) => C
	facts: (host: H, values: readonly Figure[], ports: readonly DetailPort[], screen: DeployScreen) => readonly C[]
	figure: (host: H, value: string, machine: boolean, trace?: C) => C
	figures: (host: H, values: readonly Figure[]) => C
	headline: (host: H, title: string, dot?: NonNullable<RowData['problem']>['status']) => C
	history: (host: H, readings: readonly Reading[], restarts: readonly DateTime.Utc[], now: DateTime.Utc) => C
	job: (host: H, screen: DeployScreen, item: InventoryItem, row: C, action?: RunAction) => C
	list: (host: H, rows: readonly C[]) => ReturnType<NonNullable<ListOptions<C>['list']>>
	notice: (host: H, text: string, retry?: DeployScreen['retry']) => C
	process: (host: H, process: Detail['processes'][number]) => C
	row: (host: H, options: RowOptions<C>) => C
	skeleton: (host: H) => C
	sparkline: (host: H, readings: readonly Reading[], now: DateTime.Utc) => C
	subtitle: (host: H, text: string) => C
}

function jobRow<H, C>(
	host: H,
	screen: DeployScreen,
	job: DeployScreen['list'][number],
	row: C,
	draw: WorkspaceDrawing<H, C>
) {
	if (!screen.admin) return draw.job(host, screen, job.item, row)
	return draw.job(host, screen, job.item, row, {
		disabled: screen.pending || job.item.running,
		item: job.item,
		label: `Run ${workloadName(job.item)} now`
	})
}

function listRows<H, C>(
	host: H,
	screen: DeployScreen,
	active: Selection['id'],
	wide: boolean,
	draw: WorkspaceDrawing<H, C>
) {
	const apps = Array.map(screen.list, app => {
		const options = {
			active: app.id === active,
			cover: draw.cover(host, app.item),
			item: app,
			select: screen.selection.select
		}
		if (app.job) return jobRow(host, screen, app, draw.row(host, options), draw)
		return draw.row(host, {
			...options,
			trailing: draw.figure(
				host,
				app.trailing,
				false,
				Option.getOrUndefined(
					pipe(
						app.readings,
						Option.liftPredicate(values => wide && Array.isReadonlyArrayNonEmpty(values)),
						Option.map(values => draw.sparkline(host, values, screen.now))
					)
				)
			)
		})
	})
	const rows = [
		...pipe(
			screen.machine,
			Option.fromUndefinedOr,
			Option.map(machine =>
				draw.row(host, {
					active: active === MACHINE,
					item: {id: MACHINE, line: machine.memory, title: machine.name, trailing: machine.cpu},
					select: screen.selection.select,
					trailing: draw.figure(
						host,
						machine.cpu,
						true,
						Boolean.match(wide, {
							onFalse: Function.constUndefined,
							onTrue: () => draw.sparkline(host, machine.readings, screen.now)
						})
					)
				})
			),
			Option.toArray
		),
		...apps
	]
	if (screen.listStatus !== undefined) return [...rows, draw.notice(host, screen.listStatus, screen.retry)]
	if (Array.isReadonlyArrayEmpty(screen.list)) return [...rows, draw.notice(host, 'No apps')]
	return rows
}

function history<H, C>(
	host: H,
	screen: DeployScreen,
	draw: WorkspaceDrawing<H, C>,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[]
) {
	if (screen.historyLoading) return draw.skeleton(host)
	return draw.history(host, readings, restarts, screen.now)
}

function historyStatus<H, C>(host: H, screen: DeployScreen, draw: WorkspaceDrawing<H, C>) {
	if (screen.historyStatus === undefined) return []
	if (screen.historyStatus.retry) return [draw.notice(host, screen.historyStatus.text, screen.retry)]
	return [draw.notice(host, screen.historyStatus.text)]
}

function load(label: string, value?: string) {
	if (value === undefined) return []
	return [{label, value}]
}

function overview<H, C>(host: H, screen: DeployScreen, draw: WorkspaceDrawing<H, C>) {
	if (screen.machine === undefined) return undefined
	return [
		draw.headline(host, screen.machine.name),
		draw.figures(host, [
			{label: 'CPU', value: screen.machine.cpu},
			{label: 'Memory', value: screen.machine.memory},
			{label: 'Disk', value: screen.machine.disk}
		]),
		history(host, screen, draw, screen.machine.readings, []),
		...historyStatus(host, screen, draw),
		...draw.facts(
			host,
			[{label: 'Peak, mean', value: screen.machine.peak}, ...load('Load (1m / 5m / 15m)', screen.load)],
			[],
			screen
		)
	]
}

function appFigures<H, C>(host: H, app: Detail, draw: WorkspaceDrawing<H, C>) {
	if (app.scheduled) return []
	return [
		draw.figures(host, [
			{label: 'CPU', value: app.cpu},
			{label: 'Memory', value: app.memory}
		])
	]
}

function ports(app: Detail, admin: boolean) {
	return Array.map(app.ports, port => ({
		expose: Option.filter(port.target, () => admin),
		id: port.id,
		label: port.label,
		title: `Expose ${app.name} ${port.label}`
	}))
}

function detailRows<H, C>(host: H, screen: DeployScreen, draw: WorkspaceDrawing<H, C>) {
	if (screen.loading) return [draw.skeleton(host)]
	if (screen.inventoryFailed) return [draw.notice(host, 'Couldn’t load apps', screen.retry)]
	if (screen.machineSelected) return overview(host, screen, draw)
	if (screen.detail === undefined) {
		if (screen.missing) return [draw.notice(host, 'App not found')]
		return overview(host, screen, draw)
	}
	return [
		draw.headline(host, screen.detail.name, screen.detail.status),
		...pipe(
			screen.detail.subtitle,
			Option.liftPredicate(String.isNonEmpty),
			Option.map(text => draw.subtitle(host, text)),
			Option.toArray
		),
		...appFigures(host, screen.detail, draw),
		...pipe(
			screen.detail,
			Option.liftPredicate(app => app.charted),
			Option.map(app => history(host, screen, draw, app.readings, app.restarts)),
			Option.toArray
		),
		...historyStatus(host, screen, draw),
		...draw.facts(
			host,
			[...screen.detail.facts, ...load(`${screen.machine?.name ?? 'Machine'} load (1m / 5m / 15m)`, screen.load)],
			ports(screen.detail, screen.admin),
			screen
		),
		...Array.map(screen.detail.exposures, site => draw.exposure(host, site, screen)),
		...Array.map(screen.detail.processes, process =>
			draw.row(host, {
				active: false,
				item: {id: process.key, line: process.line ?? '', title: process.label, trailing: process.value},
				trailing: draw.process(host, process)
			})
		),
		...Array.map(screen.detail.jobs, job =>
			jobRow(
				host,
				screen,
				job,
				draw.row(host, {active: false, cover: draw.cover(host, job.item), item: job, select: screen.selection.select}),
				draw
			)
		)
	]
}

export function problemText(screen: DeployScreen, fallback: string) {
	if (screen.signingIn) return 'Signing in…'
	return fallback
}

export function sheet<C>(
	screen: DeployScreen,
	draw: {
		body: (label: string, content: C) => C
		exposure: (subtitle: string, content: C) => C
		failure: (text: string) => C
		hostname: (value: string) => C
		logs: (text: string) => C
		submit: (label: string, disabled: boolean) => C
		tailnet: (url: string) => C
	},
	dialog?: NonNullable<DeployScreen['dialog']>,
	regularHeight?: number
) {
	if (dialog === undefined) return undefined
	const common = {
		dismiss: screen.dismiss,
		label: dialog.label,
		open: true,
		pending: dialog.pending,
		toolbar: {actions: dialog.toolbar, choose: screen.choose}
	}
	if (Predicate.isTagged(dialog, 'Expose')) {
		return {
			...common,
			actions: draw.submit(
				Boolean.match(screen.pending, {onFalse: Function.constant('Expose'), onTrue: Function.constant('Exposing…')}),
				dialog.disabled
			),
			body: draw.body(
				dialog.label,
				draw.exposure(
					dialog.subtitle,
					Boolean.match(dialog.kind === 'tailnet', {
						onFalse: () => draw.hostname(dialog.hostname),
						onTrue: () => draw.tailnet(dialog.text)
					})
				)
			),
			height: regularHeight
		} satisfies SheetOptions<C>
	}
	if (Predicate.isTagged(dialog, 'Logs')) {
		return {...common, actions: false as const, body: draw.body(dialog.label, draw.logs(dialog.text)), height: 0.72}
	}
	return {
		...common,
		actions: false as const,
		body: draw.body(dialog.label, draw.failure(dialog.text)),
		height: regularHeight
	}
}

export function workspace<H, C>(host: H, screen: DeployScreen, draw: WorkspaceDrawing<H, C>) {
	return {
		defaultId: screen.id,
		detail: detailRows(host, screen, draw),
		detailToolbar: screen.actions,
		list: (active: Selection['id'], wide: boolean) => draw.list(host, listRows(host, screen, active, wide, draw)),
		loading: screen.loading,
		selection: screen.selection,
		sheet: draw.sheet,
		toolbar: {actions: [], choose: screen.choose}
	}
}
