import {Native} from '@effect/ui-native'

import {Array, Boolean, Function, Option} from 'effect'

import type {PaneLeaf, RowData} from '@deslop/design/model'
import {Layout, ListDetail, Row, black, fold, ink, status, nativeControls, styles} from '@deslop/design/native'

import type {InventoryItem} from '#contracts'

import {History, Sparkline} from '#iphone/chart.ts'
import type {DeployScreen} from '#screens/deploy.ts'
import {artworkOf} from '#screens/marks.ts'
import {problemText, sheet, workspace} from '#screens/presentation.ts'
import type {Detail, DetailPort, Exposure, Figure, RunAction, WorkspaceDrawing} from '#screens/presentation.ts'

const FIGURES = ['tabular-nums'] as const
const Image: <M>() => Native.ViewElement<M, never, Record<string, unknown>, 'deployImage'> = Function.constant(
	Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, 'deployImage'>('deployImage'), {
		viewName: 'RCTImageView'
	})
)

const controls = nativeControls()
function Cover<M>(h: Native.H<M>, item: InventoryItem) {
	const art = artworkOf(item)
	const size = Boolean.match(art.pixel, {onFalse: Function.constant(24), onTrue: Function.constant(32)})
	return h.view.style({alignItems: 'center', flexShrink: 0, height: 32, justifyContent: 'center', width: 32}).children(
		Boolean.match(art.source === undefined, {
			onFalse: () =>
				Image<M>()
					.style({height: size, width: size})
					.prop('resizeMode', 'contain')
					.prop('source', [{height: size, scale: 1, uri: art.source, width: size}]),
			onTrue: () => h.text.style(styles.line).children('›_')
		})
	)
}

function WarmSkeleton<M>(h: Native.H<M>) {
	return h.view
		.style({gap: 12})
		.children(
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 20, width: '38%'}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 14, width: '65%'}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 96, width: '92%'})
		)
}

function RunRow<M>(
	h: Native.H<M>,
	screen: DeployScreen,
	item: InventoryItem,
	row: Native.NoTextInput<M>,
	action?: RunAction
) {
	return h.view
		.key(item.id)
		.style({alignItems: 'center', flexDirection: 'row', gap: 4})
		.children(
			h.view.style({flex: 1}).children(row),
			action !== undefined &&
				controls.Button(
					h,
					screen
						.run(screen.run(h.view, 'press', action.item), 'accessibilityTap', action.item)
						.prop('accessibilityLabel', action.label),
					'Run',
					action.disabled
				)
		)
}

function Headline<M>(h: Native.H<M>, label: string, dot?: NonNullable<RowData['problem']>['status']) {
	return h.view.style(styles.titleLine).children(
		dot !== undefined && h.view.style({...styles.dot, backgroundColor: status[dot]}),
		h.text
			.style({...styles.heading, flexShrink: 1})
			.prop('accessibilityRole', 'header')
			.children(label)
	)
}

function Figures<M>(h: Native.H<M>, values: readonly Figure[]) {
	return h.view
		.style({columnGap: 16, flexDirection: 'row', flexWrap: 'wrap', rowGap: 8})
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
		.style({alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between'})
		.children(
			h.text.style(styles.line).children(label),
			h.text
				.style({...styles.line, color: ink, flexShrink: 1, fontVariant: FIGURES, textAlign: 'right'})
				.children(value)
		)
}

function Ports<M>(h: Native.H<M>, screen: DeployScreen, ports: readonly DetailPort[]) {
	if (Array.isReadonlyArrayEmpty(ports)) return []
	return [
		h.view.style({alignItems: 'center', flexDirection: 'row', gap: 8}).children(
			h.text.style(styles.line).children('Port'),
			h.view
				.style({
					alignItems: 'center',
					flex: 1,
					flexDirection: 'row',
					flexWrap: 'wrap',
					gap: 4,
					justifyContent: 'flex-end'
				})
				.children(
					Array.map(ports, port =>
						Option.match(port.expose, {
							onNone: () => h.text.key(port.id).style(styles.body).children(port.label),
							onSome: target =>
								controls.Button(
									h,
									screen
										.expose(screen.expose(h.view, 'press', target), 'accessibilityTap', target)
										.key(port.id)
										.prop('accessibilityLabel', port.title),
									port.label,
									screen.pending
								)
						})
					)
				)
		)
	]
}

function Facts<M>(h: Native.H<M>, values: readonly Figure[], ports: readonly DetailPort[], screen: DeployScreen) {
	return [...Array.map(values, fact => Fact(h, fact.label, fact.value)), ...Ports(h, screen, ports)]
}

function Site<M>(h: Native.H<M>, site: Exposure, screen: DeployScreen) {
	return h.view
		.key(site.id)
		.style(styles.titleLine)
		.children(
			site.status !== undefined && h.view.style({...styles.dot, backgroundColor: status[site.status]}),
			Option.match(Option.fromUndefinedOr(site.url), {
				onNone: () => h.text.style(styles.body).children(site.label),
				onSome: url =>
					controls.Button(h, screen.openUrl(screen.openUrl(h.view, 'press', url), 'accessibilityTap', url), site.label)
			}),
			site.line !== undefined && h.text.style({...styles.line, flexShrink: 1}).children(site.line)
		)
}

function ProcessReading<M>(h: Native.H<M>, process: Detail['processes'][number]) {
	return h.view
		.style({alignItems: 'center', flexDirection: 'row', gap: 8})
		.children(
			h.view
				.style({backgroundColor: fold, borderRadius: 2, height: 4, width: 40})
				.children(
					h.view.style({
						backgroundColor: styles.line.color,
						borderRadius: 2,
						height: 4,
						width: `${process.proportion}%`
					})
				),
			h.text.style({...styles.line, fontVariant: FIGURES}).children(process.value)
		)
}

function Sheet<M>(h: Native.H<M>, screen: DeployScreen) {
	return sheet<PaneLeaf<Native.NoTextInput<M>>>(
		screen,
		{
			body: (label, content) => h.view.style({gap: 8}).children(h.text.style(styles.heading).children(label), content),
			exposure: (subtitle, content) =>
				h.view.style({gap: 8}).children(h.text.style(styles.line).children(subtitle), content),
			failure: text => h.text.style(styles.body).children(text),
			hostname: value =>
				h.view.children(
					h.text.style(styles.body).children('Hostname'),
					screen
						.hostname(h.input, 'input')
						.style({...styles.body, borderColor: fold, borderRadius: 8, borderWidth: 1, minHeight: 40, padding: 8})
						.prop('accessibilityLabel', 'Hostname')
						.prop('autoCapitalize', 'none')
						.prop('autoCorrect', false)
						.prop('editable', !screen.pending)
						.placeholder('app.example.com')
						.value(value)
				),
			logs: text =>
				h.text.style({...styles.body, fontFamily: 'ui-monospace', fontSize: 12, lineHeight: 17}).children(text),
			submit: (label, disabled) =>
				controls.Button(h, screen.submit(screen.submit(h.view, 'press'), 'accessibilityTap'), label, disabled),
			tailnet: url => h.text.style(styles.body).children(url)
		},
		screen.dialog,
		0.58
	)
}

export function Workspace<M>(h: Native.H<M>, screen: DeployScreen) {
	if (screen.problem !== undefined) {
		return Layout(h, {
			content: h.view
				.style({
					alignItems: 'flex-start',
					backgroundColor: black,
					flex: 1,
					gap: 8,
					justifyContent: 'center',
					padding: 20
				})
				.children(
					h.text.style(styles.body).children(problemText(screen, screen.problem.text)),
					screen.problem.signIn === true &&
						!screen.signingIn &&
						controls.Button(
							h,
							screen.authenticate(screen.authenticate(h.view, 'press'), 'accessibilityTap'),
							'Continue with GitHub'
						),
					screen.problem.back === true &&
						controls.Button(
							h,
							screen.selection.back(screen.selection.back(h.view, 'press'), 'accessibilityTap'),
							'Back to Deploy'
						)
				)
		})
	}
	const draw: WorkspaceDrawing<Native.H<M>, PaneLeaf<Native.NoTextInput<M>>> = {
		cover: Cover,
		exposure: Site,
		facts: Facts,
		figure: (native, value, machine, trace) =>
			native.view
				.style({alignItems: 'center', flexDirection: 'row', gap: 8})
				.children(
					trace,
					native.text
						.style(
							Boolean.match(machine, {
								onFalse: () => ({...styles.line, fontVariant: FIGURES, minWidth: 92, textAlign: 'right' as const}),
								onTrue: () => ({...styles.line, fontVariant: FIGURES})
							})
						)
						.children(value)
				),
		figures: Figures,
		headline: Headline,
		history: History,
		job: RunRow,
		list: (native, rows) => native.view.key('apps').children(rows),
		notice: controls.Notice,
		process: ProcessReading,
		row: Row,
		sheet: Sheet(h, screen),
		skeleton: WarmSkeleton,
		sparkline: Sparkline,
		subtitle: (native, value) => native.text.style(styles.line).children(value)
	}
	return ListDetail(h, workspace(h, screen, draw))
}
