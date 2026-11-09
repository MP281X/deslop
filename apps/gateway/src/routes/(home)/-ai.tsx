import {useAtom, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {
	Array,
	Boolean,
	Cause,
	HashMap,
	HashSet,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {XIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactNode} from 'react'
import {Bar, BarChart, XAxis} from 'recharts'

import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Stat} from '@deslop/components-web/page'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent
} from '@deslop/components-web/ui/chart'
import type {ChartConfig} from '@deslop/components-web/ui/chart'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle
} from '@deslop/components-web/ui/dialog'
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components-web/ui/select'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {cn} from '@deslop/components-web/utils'
import {isDenied} from '@deslop/runtime/auth/utils'

import {aiKeysAtom, aiUsageAtom, removeKeyAtom, setKeyAtom} from '#lib/utils.ts'
import type {Period} from '#lib/utils.ts'
import {FailureContent} from '#routes/(home)/-failure.tsx'
import {AiProvider} from '#services/ai/schema.ts'
import type {AiKeyInfo, AiUsageCell, AiUsageReport} from '#services/ai/schema.ts'

const PERIODS = [
	{label: '24h', name: 'last 24 hours', value: '24h'},
	{label: '7d', name: 'last 7 days', value: '7d'},
	{label: '30d', name: 'last 30 days', value: '30d'}
] satisfies {label: string; name: string; value: Period}[]
// Each app's identity hue; any other client takes a hue none of the shown apps holds.
const IDENTITIES: Record<string, {color: string; name: string}> = {
	auth: {color: 'var(--slate)', name: 'Auth'},
	deploy: {color: 'var(--blue)', name: 'Deploy'},
	gateway: {color: 'var(--pink)', name: 'Gateway'},
	opm: {color: 'var(--ivory)', name: 'OPM'},
	scope: {color: 'var(--cyan)', name: 'Scope'},
	stash: {color: 'var(--amber)', name: 'Stash'},
	trips: {color: 'var(--orange)', name: 'Trips'}
}
const SPARE = ['var(--purple)', 'var(--cyan)', 'var(--blue)', 'var(--coral)', 'var(--machine-dev)', 'var(--ivory)']
const PROVIDER_NAMES = {
	anthropic: 'Anthropic',
	'opencode-go': 'OpenCode Go',
	'opencode-zen': 'OpenCode Zen',
	openrouter: 'OpenRouter'
} satisfies Record<AiProvider, string>
export const PROVIDERS = AiProvider.literals
const usd = new Intl.NumberFormat('en', {
	currency: 'USD',
	maximumFractionDigits: 2,
	minimumFractionDigits: 2,
	style: 'currency'
})
const compact = new Intl.NumberFormat('en', {maximumFractionDigits: 1, notation: 'compact'})
const count = new Intl.NumberFormat('en')
const weekday = new Intl.DateTimeFormat('en', {timeZone: 'UTC', weekday: 'short'})
const shortDay = new Intl.DateTimeFormat('en', {day: 'numeric', month: 'short', timeZone: 'UTC'})
const longDay = new Intl.DateTimeFormat('en', {day: 'numeric', month: 'short', timeZone: 'UTC', weekday: 'short'})
const hour = new Intl.DateTimeFormat('en', {hour: '2-digit', hourCycle: 'h23', minute: '2-digit'})
const longHour = new Intl.DateTimeFormat('en', {hour: '2-digit', hourCycle: 'h23', minute: '2-digit', weekday: 'short'})

export type Metric = 'cost' | 'tokens'
export type Focus = {app?: string; bucket?: number; model?: string}
type Range = {bucket: 'day' | 'hour'; count: number; from: number; size: number}
type Sum = {calls: number; costUsd: number; name: string; tokens: number; unknownCostCalls: number}

function cost(value: number) {
	if (value > 0 && value < 0.01) return '<$0.01'
	return usd.format(value)
}
function amount(metric: Metric, value: unknown) {
	if (!Predicate.isNumber(value)) return ''
	if (metric === 'cost') return cost(value)
	return compact.format(value)
}
// A share bar's width, nothing when there is nothing to share.
function share(part: number, whole: number) {
	if (whole === 0) return 0
	return part / whole
}

// Auth's client label maps to the same identity on the chart and its rows.
const appKey = String.toLowerCase
function appName(app: string) {
	const identity = IDENTITIES[appKey(app)]
	if (identity !== undefined) return identity.name
	return app
}

function sums(cells: readonly AiUsageCell[], key: (cell: AiUsageCell) => string) {
	return Array.map(
		Record.toEntries(Array.groupBy(cells, key)),
		entry =>
			({
				calls: Number.sumAll(Array.map(entry[1], cell => cell.calls)),
				costUsd: Number.sumAll(Array.map(entry[1], cell => cell.costUsd)),
				name: entry[0],
				tokens: Number.sumAll(Array.map(entry[1], cell => cell.tokens)),
				unknownCostCalls: Number.sumAll(Array.map(entry[1], cell => cell.unknownCostCalls))
			}) satisfies Sum
	)
}
function measure(metric: Metric) {
	return (sum: {costUsd: number; tokens: number}) => {
		if (metric === 'cost') return sum.costUsd
		return sum.tokens
	}
}
// A sum whose every call had no known price shows a dash, not a zero.
function costOf(sum: Sum) {
	if (sum.costUsd === 0 && sum.unknownCostCalls > 0) return '—'
	return cost(sum.costUsd)
}

// The axis names a few buckets; the last is the current one.
function tickLabel(range: Range) {
	return (bucket: string) =>
		Option.match(Option.filter(Number.parse(bucket), Schema.is(Schema.Finite)), {
			onNone: () => '—',
			onSome: at => {
				if (at === range.from + (range.count - 1) * range.size) {
					return Boolean.match(range.bucket === 'hour', {onFalse: () => 'Today', onTrue: () => 'Now'})
				}
				if (range.bucket === 'hour') return hour.format(at)
				if (range.count <= 7) return weekday.format(at)
				return shortDay.format(at)
			}
		})
}
// Every day of a week; otherwise every sixth hour or seventh day, counted back from the current bucket.
function tickStep(buckets: number) {
	if (buckets <= 7) return 1
	if (buckets === 24) return 6
	return 7
}
function bucketLabel(bucket: Range['bucket'], at: number) {
	if (bucket === 'hour') return longHour.format(at)
	return longDay.format(at)
}

// The page's two choices beside the view: which window, and whether bars measure cost or tokens.
export function AiControls(props: {
	metric: Metric
	onMetric: (metric: Metric) => void
	onPeriod: (period: Period) => void
	period: Period
}) {
	return (
		<>
			<ToggleGroup
				aria-label="Period"
				size="sm"
				spacing={1}
				variant="outline"
				value={[props.period]}
				onValueChange={values =>
					Option.map(
						Option.flatMap(Array.head(values), value => Array.findFirst(PERIODS, entry => entry.value === value)),
						entry => props.onPeriod(entry.value)
					)
				}
			>
				{Array.map(PERIODS, entry => (
					<ToggleGroupItem key={entry.value} value={entry.value} className="max-sm:h-11">
						{entry.label}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<ToggleGroup
				aria-label="Measure"
				size="sm"
				spacing={1}
				variant="outline"
				value={[props.metric]}
				onValueChange={values =>
					Option.map(Array.head(values), value =>
						props.onMetric(Boolean.match(value === 'tokens', {onFalse: () => 'cost', onTrue: () => 'tokens'}))
					)
				}
			>
				<ToggleGroupItem value="cost" className="max-sm:h-11">
					Cost
				</ToggleGroupItem>
				<ToggleGroupItem value="tokens" className="max-sm:h-11">
					Tokens
				</ToggleGroupItem>
			</ToggleGroup>
		</>
	)
}

// A muted label over a group of rows.
function GroupLabel(props: {children: ReactNode}) {
	return (
		<h2 className="text-muted-foreground text-label tracking-label border-b pb-1 font-mono font-medium uppercase">
			{props.children}
		</h2>
	)
}

// The whole row is one button: it narrows the page or runs its action; a context menu, when given, holds the rest.
function Row(props: {children: ReactNode; label: string; menu?: ReactNode; onClick: () => void; selected?: boolean}) {
	return (
		<div
			role="listitem"
			className={cn('list-row', props.selected === true && 'border-l-primary border-l-2')}
			data-selected={props.selected}
		>
			<ContextMenu disabled={props.menu === undefined}>
				<div className="relative flex h-12 min-w-0 items-center gap-3 px-0">
					<ContextMenuTrigger
						render={
							<Button
								variant={Boolean.match(props.selected === true, {
									onFalse: () => 'ghost' as const,
									onTrue: () => 'secondary' as const
								})}
								type="button"
								aria-label={props.label}
								aria-pressed={props.selected}
								onClick={props.onClick}
								className="absolute inset-0 h-full w-full"
							/>
						}
					/>
					<div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">{props.children}</div>
				</div>
				{props.menu !== undefined && <ContextMenuContent className="w-auto min-w-36">{props.menu}</ContextMenuContent>}
			</ContextMenu>
		</div>
	)
}

// Name, share of the shown total, tokens and cost: the same columns in both breakdowns.
function ShareRow(props: {
	color: string
	label: string
	menu?: ReactNode
	onClick: () => void
	selected: boolean
	share: number
	sum: Option.Option<Sum>
}) {
	return (
		<Row label={props.label} menu={props.menu} onClick={props.onClick} selected={props.selected}>
			<span className="min-w-0 flex-1 truncate text-sm font-medium">{props.label}</span>
			<span className="flex h-1 w-16 shrink-0">
				<span
					className="h-full w-(--share) bg-(--share-color)"
					style={{'--share': `${props.share * 100}%`, '--share-color': props.color}}
				/>
			</span>
			{/* Audio models are billed by the minute, which the ledger doesn't hold, so they show no tokens rather than zero. */}
			<span className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs tabular-nums">
				{Option.getOrElse(
					Option.map(
						Option.filter(props.sum, sum => sum.tokens > 0),
						sum => compact.format(sum.tokens)
					),
					() => '—'
				)}
			</span>
			<span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
				{Option.match(props.sum, {onNone: () => '—', onSome: costOf})}
			</span>
		</Row>
	)
}

// A destructive question; it closes itself once the action commits, and a failure stays in it.
function ConfirmDialog(props: {
	action: string
	description: string
	onOpenChange: (open: boolean) => void
	open: boolean
	result: AsyncResult.AsyncResult<unknown, {message: string}>
	run: () => void
	title: string
}) {
	const waiting = AsyncResult.isWaiting(props.result)
	return (
		<Dialog open={props.open && !AsyncResult.isSuccess(props.result)} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogTitle>{props.title}</DialogTitle>
				<DialogDescription>{props.description}</DialogDescription>
				<ResultError result={props.result} />
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" disabled={waiting} />}>Cancel</DialogClose>
					<Button variant="destructive" disabled={waiting} onClick={props.run}>
						{props.action}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function UsageChart(props: {
	apps: readonly {app: string; color: string; key: string}[]
	metric: Metric
	onBucket: (at: number) => void
	range: Range
	report: AiUsageReport
}) {
	const value = measure(props.metric)
	const byTime = HashMap.fromIterable(
		Array.map(
			props.report.series,
			bucket => [bucket.at, HashMap.fromIterable(Array.map(bucket.byApp, sum => [sum.name, sum] as const))] as const
		)
	)
	// Each bucket's start as text, so the axis and the tooltip get it back as their label.
	const rows = Array.map(Array.range(0, props.range.count - 1), index => {
		const bucket = HashMap.get(byTime, props.range.from + index * props.range.size)
		return {
			bucket: `${props.range.from + index * props.range.size}`,
			...Record.fromEntries(
				Array.map(props.apps, app => [
					app.key,
					Option.getOrUndefined(
						Option.map(
							Option.flatMap(bucket, totals => HashMap.get(totals, app.app)),
							value
						)
					)
				])
			)
		}
	})
	const step = tickStep(props.range.count)
	const config = Record.fromEntries(
		Array.map(props.apps, app => [app.key, {color: app.color, label: appName(app.app)}])
	) satisfies ChartConfig
	return (
		<div className="border-y">
			<ChartContainer config={config} className="h-48 w-full max-sm:h-40">
				<BarChart
					accessibilityLayer
					barCategoryGap={2}
					barGap={0}
					// Recharts 3 focuses a layer chart.tsx doesn't cover when a bar is clicked; the tooltip already shows what is chosen.
					className="[&_[tabindex]]:outline-hidden"
					data={rows}
					margin={{bottom: 0, left: 0, right: 0, top: 4}}
					onClick={state =>
						Option.map(
							Option.flatMap(Option.liftPredicate(state.activeLabel, Predicate.isString), Number.parse),
							props.onBucket
						)
					}
				>
					<XAxis
						dataKey="bucket"
						ticks={Array.filter(
							Array.map(rows, row => row.bucket),
							(_, index) => (props.range.count - 1 - index) % step === 0
						)}
						interval={0}
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						tickFormatter={tickLabel(props.range)}
					/>
					<ChartTooltip
						content={
							<ChartTooltipContent
								labelFormatter={label =>
									Option.getOrElse(
										Option.map(Option.flatMap(Option.liftPredicate(label, Predicate.isString), Number.parse), at =>
											bucketLabel(props.range.bucket, at)
										),
										() => ''
									)
								}
								formatter={(shown, name, item) => (
									<>
										<span className="size-2.5 shrink-0 bg-(--swatch)" style={{'--swatch': item.color ?? ''}} />
										<span className="text-muted-foreground flex-1">{config[`${name}`]?.label}</span>
										<span className="text-foreground font-mono font-medium tabular-nums">
											{amount(props.metric, shown)}
										</span>
									</>
								)}
							/>
						}
					/>
					{Array.map(props.apps, app => (
						<Bar
							key={app.key}
							dataKey={app.key}
							stackId="usage"
							fill={`var(--color-${app.key})`}
							isAnimationActive={false}
						/>
					))}
					<ChartLegend content={<ChartLegendContent />} />
				</BarChart>
			</ChartContainer>
		</div>
	)
}

function FocusChip(props: {bucket: Range['bucket']; focus: Focus; onClear: () => void}) {
	return Option.match(
		pipe(
			Option.map(Option.fromUndefinedOr(props.focus.app), appName),
			Option.orElse(() => Option.fromUndefinedOr(props.focus.model)),
			Option.orElse(() => Option.map(Option.fromUndefinedOr(props.focus.bucket), at => bucketLabel(props.bucket, at)))
		),
		{
			onNone: () => null,
			onSome: text => (
				<div className="flex">
					<Button variant="secondary" size="xs" aria-label={`Show all, not only ${text}`} onClick={props.onClear}>
						{text}
						<XIcon data-icon="inline-end" />
					</Button>
				</div>
			)
		}
	)
}

// The period at a glance: three large figures across the grid, with the daily average as their one caption.
function Stats(props: {range: Range; report: AiUsageReport}) {
	return (
		<div className="flex flex-col gap-3 border-y py-4">
			<div className="grid grid-cols-3 gap-6">
				<Stat large label="Spent" value={cost(props.report.totals.costUsd)} />
				<Stat large label="Tokens" value={compact.format(props.report.totals.tokens)} />
				<Stat large label="Calls" value={count.format(props.report.totals.calls)} />
			</div>
			<span className="text-muted-foreground text-label tracking-label font-mono uppercase max-sm:hidden">
				Per day{' '}
				{cost(
					props.report.totals.costUsd /
						Boolean.match(props.range.bucket === 'hour', {onFalse: () => props.range.count, onTrue: () => 1})
				)}
			</span>
		</div>
	)
}

function UsageReport(props: {
	focus: Focus
	metric: Metric
	onFocus: (focus: Focus) => void
	period: Period
	range: Range
	report: AiUsageReport
}) {
	if (Array.isReadonlyArrayEmpty(props.report.cells)) {
		return (
			<>
				<Stats range={props.range} report={props.report} />
				<p role="status" className="text-muted-foreground py-16 text-center text-sm">
					No AI calls in the{' '}
					{Option.getOrElse(
						Option.map(
							Array.findFirst(PERIODS, entry => entry.value === props.period),
							entry => entry.name
						),
						() => 'period'
					)}
				</p>
			</>
		)
	}
	const value = measure(props.metric)
	const byMetric = Order.flip(Order.mapInput(Order.Number, value))
	const allApps = Array.sort(
		sums(props.report.cells, cell => cell.app),
		byMetric
	)
	const taken = HashSet.fromIterable(
		Array.filter(
			Array.map(allApps, sum => IDENTITIES[appKey(sum.name)]?.color),
			Predicate.isNotUndefined
		)
	)
	const spare = Array.filter(SPARE, color => !HashSet.has(taken, color))
	const unnamed = Array.filter(
		Array.map(allApps, sum => sum.name),
		app => IDENTITIES[appKey(app)] === undefined
	)
	function colorOf(app: string) {
		return (
			IDENTITIES[appKey(app)]?.color ??
			Option.getOrElse(
				Array.get(
					spare,
					Option.getOrElse(
						Array.findFirstIndex(unnamed, name => name === app),
						() => 0
					) % Number.max(1, spare.length)
				),
				() => 'var(--chart-3)'
			)
		)
	}
	const inBucket = Array.filter(
		props.report.cells,
		cell => props.focus.bucket === undefined || cell.at === props.focus.bucket
	)
	const appSums = Array.sort(
		sums(
			Array.filter(inBucket, cell => props.focus.model === undefined || cell.model === props.focus.model),
			cell => cell.app
		),
		byMetric
	)
	const modelSums = Array.sort(
		sums(
			Array.filter(inBucket, cell => props.focus.app === undefined || cell.app === props.focus.app),
			cell => cell.model
		),
		byMetric
	)
	const appTotal = Number.sumAll(Array.map(appSums, value))
	const modelTotal = Number.sumAll(Array.map(modelSums, value))
	// Tapping what is already chosen shows everything again.
	function toggle(next: Focus) {
		const same =
			(next.app !== undefined && next.app === props.focus.app) ||
			(next.model !== undefined && next.model === props.focus.model) ||
			(next.bucket !== undefined && next.bucket === props.focus.bucket)
		props.onFocus(Boolean.match(same, {onFalse: () => next, onTrue: () => ({})}))
	}
	return (
		<>
			<Stats range={props.range} report={props.report} />
			<UsageChart
				apps={Array.map(allApps, (sum, index) => ({app: sum.name, color: colorOf(sum.name), key: `app${index}`}))}
				metric={props.metric}
				onBucket={at => toggle({bucket: at})}
				range={props.range}
				report={props.report}
			/>
			<FocusChip focus={props.focus} bucket={props.range.bucket} onClear={() => props.onFocus({})} />
			<div className="grid gap-6 md:grid-cols-2 md:gap-0 md:divide-x">
				<section aria-label="By app" className="flex min-w-0 flex-col md:pr-4">
					<GroupLabel>By app</GroupLabel>
					<div role="list" aria-label="By app">
						{Array.map(appSums, sum => (
							<ShareRow
								key={sum.name}
								label={appName(sum.name)}
								color={colorOf(sum.name)}
								onClick={() => toggle({app: sum.name})}
								selected={props.focus.app === sum.name}
								share={share(value(sum), appTotal)}
								sum={Option.some(sum)}
							/>
						))}
					</div>
				</section>
				<section aria-label="By model" className="flex min-w-0 flex-col md:pl-4">
					<GroupLabel>By model</GroupLabel>
					<div role="list" aria-label="By model">
						{Array.map(modelSums, sum => (
							<ShareRow
								key={sum.name}
								color="var(--primary)"
								label={sum.name}
								onClick={() => toggle({model: sum.name})}
								selected={props.focus.model === sum.name}
								share={share(value(sum), modelTotal)}
								sum={Option.some(sum)}
							/>
						))}
					</div>
				</section>
			</div>
		</>
	)
}

// judge-ignore no-dropped-content -- a period's usage loads once; only this failure's Retry reloads it, so nothing loaded can drop.
function Usage(props: {focus: Focus; metric: Metric; onFocus: (focus: Focus) => void; period: Period}) {
	const result = useAtomSuspense(aiUsageAtom(props.period), {includeFailure: true})
	const refresh = useAtomRefresh(aiUsageAtom(props.period))
	if (AsyncResult.isFailure(result)) return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	return <UsageReport {...props} range={result.value.range} report={result.value.report} />
}

function RemoveKeyDialog(props: {onOpenChange: (open: boolean) => void; open: boolean; provider: AiProvider}) {
	const [result, remove] = useAtom(removeKeyAtom(props.provider))
	return (
		<ConfirmDialog
			action="Remove key"
			description="Apps calling this provider through Gateway stop until you add a key again."
			open={props.open}
			onOpenChange={props.onOpenChange}
			result={result}
			run={() => remove()}
			title={`Remove the ${PROVIDER_NAMES[props.provider]} key?`}
		/>
	)
}

// A provider's key by its last four, what it cost in the period and its light: red once the provider refused it.
function KeyRow(props: {info: Option.Option<AiKeyInfo>; onAdd: () => void; provider: AiProvider; spent: string}) {
	const [confirm, setConfirm] = useState(false)
	const reset = useAtomSet(removeKeyAtom(props.provider))
	const rejected = Option.exists(props.info, info => info.lastStatus === 401 || info.lastStatus === 403)
	const detail = Option.match(props.info, {
		onNone: () => 'no key',
		onSome: info =>
			Boolean.match(rejected, {onFalse: () => `••••${info.last4}`, onTrue: () => `${info.lastStatus} · replace key`})
	})
	return (
		<>
			{Option.isSome(props.info) && (
				<RemoveKeyDialog open={confirm} onOpenChange={setConfirm} provider={props.provider} />
			)}
			<Row
				label={`${PROVIDER_NAMES[props.provider]}, ${detail}`}
				onClick={props.onAdd}
				menu={Option.match(props.info, {
					onNone: () => undefined,
					onSome: () => (
						<>
							<ContextMenuItem className="max-sm:h-11" onClick={props.onAdd}>
								Replace key
							</ContextMenuItem>
							<ContextMenuItem
								variant="destructive"
								className="max-sm:h-11"
								onClick={() => {
									reset(Atom.Reset)
									setConfirm(true)
								}}
							>
								Remove key
							</ContextMenuItem>
						</>
					)
				})}
			>
				<span className="w-28 min-w-0 shrink-0 truncate text-sm font-medium">{PROVIDER_NAMES[props.provider]}</span>
				<span
					className={cn(
						'min-w-0 flex-1 truncate font-mono text-xs',
						Boolean.match(rejected, {onFalse: () => 'text-muted-foreground', onTrue: () => 'text-destructive'})
					)}
				>
					{detail}
				</span>
				<span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">{props.spent}</span>
				<span className="flex size-3 shrink-0 items-center justify-center">
					<StatusDot
						status={Option.match(props.info, {
							onNone: () => 'off' as const,
							onSome: () => Boolean.match(rejected, {onFalse: () => 'live' as const, onTrue: () => 'error' as const})
						})}
					/>
				</span>
			</Row>
		</>
	)
}

function Keys(props: {onAdd: (provider: Option.Option<AiProvider>) => void; period: Period}) {
	const result = useAtomSuspense(aiKeysAtom, {includeFailure: true})
	const usage = useAtomValue(aiUsageAtom(props.period))
	if (AsyncResult.isFailure(result)) {
		if (Option.exists(AsyncResult.error(result), isDenied)) return null
		return <ResultError result={result} />
	}
	const byProvider = AsyncResult.getOrElse(
		AsyncResult.map(usage, value => value.report.byProvider),
		() => []
	)
	return (
		<section aria-label="Keys" className="flex flex-col">
			<GroupLabel>Keys</GroupLabel>
			<div role="list" aria-label="Keys">
				{Array.match(result.value, {
					onEmpty: () => (
						<Row label="Add a provider key" onClick={() => props.onAdd(Option.none())}>
							<span className="text-muted-foreground text-sm">Add a provider key</span>
						</Row>
					),
					onNonEmpty: keys =>
						Array.map(PROVIDERS, provider => (
							<KeyRow
								key={provider}
								provider={provider}
								info={Array.findFirst(keys, key => key.provider === provider)}
								onAdd={() => props.onAdd(Option.some(provider))}
								spent={Option.getOrElse(
									Option.map(
										Array.findFirst(byProvider, entry => entry.name === provider),
										costOf
									),
									() => '—'
								)}
							/>
						))
				})}
			</div>
		</section>
	)
}

export function AiPane(props: {
	focus: Focus
	metric: Metric
	onAdd: (provider: Option.Option<AiProvider>) => void
	onFocus: (focus: Focus) => void
	period: Period
}) {
	return (
		<CatchBoundary getResetKey={() => `ai-${props.period}`} errorComponent={FailureContent}>
			<Suspense fallback={<ItemListSkeleton label="AI usage" rows={6} />}>
				<Usage focus={props.focus} metric={props.metric} onFocus={props.onFocus} period={props.period} />
			</Suspense>
			<Suspense fallback={<ItemListSkeleton label="Keys" rows={4} />}>
				<Keys onAdd={props.onAdd} period={props.period} />
			</Suspense>
		</CatchBoundary>
	)
}

// One dialog adds or replaces a key: the provider, then the secret, which never comes back; it closes once saved.
export function AddKeyDialog(props: {
	onOpenChange: (open: boolean) => void
	onProvider: (provider: AiProvider) => void
	open: boolean
	provider: AiProvider
}) {
	const [result, save] = useAtom(setKeyAtom)
	const [secret, setSecret] = useState('')
	const waiting = AsyncResult.isWaiting(result)
	return (
		<Dialog open={props.open && !AsyncResult.isSuccess(result)} onOpenChange={props.onOpenChange}>
			<DialogContent showCloseButton={!waiting}>
				<form
					className="flex flex-col gap-4"
					onSubmit={event => {
						event.preventDefault()
						save({provider: props.provider, secret})
					}}
				>
					<DialogTitle>Add a key</DialogTitle>
					<Field>
						<FieldLabel htmlFor="ai-provider">Provider</FieldLabel>
						<Select
							items={Array.map(PROVIDERS, value => ({label: PROVIDER_NAMES[value], value}))}
							value={props.provider}
							onValueChange={value => Option.map(Option.fromNullOr(value), props.onProvider)}
							disabled={waiting}
						>
							<SelectTrigger id="ai-provider" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Array.map(PROVIDERS, value => (
									<SelectItem key={value} value={value}>
										{PROVIDER_NAMES[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor="ai-secret">Key</FieldLabel>
						<Input
							id="ai-secret"
							type="password"
							autoComplete="off"
							required
							autoFocus
							value={secret}
							disabled={waiting}
							onChange={event => setSecret(event.target.value)}
						/>
					</Field>
					<ResultError result={result} />
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" type="button" disabled={waiting} />}>Cancel</DialogClose>
						<Button type="submit" disabled={waiting || secret === ''}>
							{Boolean.match(waiting, {onFalse: () => 'Save key', onTrue: () => 'Saving…'})}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
