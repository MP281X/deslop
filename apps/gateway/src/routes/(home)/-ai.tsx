import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, HashMap, Number, Option, Order, Predicate, Record, Schema, String, pipe} from 'effect'

import {CubeIcon, KeyIcon, PlusIcon, SparkleIcon, SquaresFourIcon, XIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactNode} from 'react'
import {Bar, BarChart, XAxis} from 'recharts'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {ItemListHeading, ItemListSkeleton} from '@deslop/components-web/item-list'
import {Stat} from '@deslop/components-web/page'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {ChartContainer, ChartTooltip, ChartTooltipContent} from '@deslop/components-web/ui/chart'
import type {ChartConfig} from '@deslop/components-web/ui/chart'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Item, ItemActions, ItemContent, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components-web/ui/select'
import {Tabs, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
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
// Each app's identity hue; any other client is zinc grey.
const IDENTITIES: Record<string, {color: string; name: string}> = {
	auth: {color: 'var(--slate)', name: 'Auth'},
	deploy: {color: 'var(--blue)', name: 'Deploy'},
	gateway: {color: 'var(--pink)', name: 'Gateway'},
	opm: {color: 'var(--ivory)', name: 'OPM'},
	portfolio: {color: 'var(--coral)', name: 'Portfolio'},
	scope: {color: 'var(--cyan)', name: 'Scope'},
	stash: {color: 'var(--amber)', name: 'Stash'},
	trips: {color: 'var(--orange)', name: 'Trips'}
}
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
function share(part: number, whole: number) {
	if (whole === 0) return 0
	return part / whole
}

const appKey = String.toLowerCase
function appName(app: string) {
	const identity = IDENTITIES[appKey(app)]
	if (identity !== undefined) return identity.name
	return app
}
function colorOf(app: string) {
	return IDENTITIES[appKey(app)]?.color ?? 'var(--muted-foreground)'
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
function costOf(sum: Sum) {
	if (sum.costUsd === 0 && sum.unknownCostCalls > 0) return '—'
	return cost(sum.costUsd)
}

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
function tickStep(buckets: number) {
	if (buckets <= 7) return 1
	if (buckets === 24) return 6
	return 7
}
function bucketLabel(bucket: Range['bucket'], at: number) {
	if (bucket === 'hour') return longHour.format(at)
	return longDay.format(at)
}

// The window beside the view, in the bar at every width.
export function AiControls(props: {onPeriod: (period: Period) => void; period: Period}) {
	return (
		<Tabs
			value={props.period}
			onValueChange={value =>
				Option.map(
					Array.findFirst(PERIODS, entry => entry.value === value),
					entry => props.onPeriod(entry.value)
				)
			}
		>
			<TabsList aria-label="Period">
				{Array.map(PERIODS, entry => (
					<TabsTrigger key={entry.value} value={entry.value}>
						{entry.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	)
}

// The measure only switches the chart, so it sits on the card's summary line.
function MetricTabs(props: {metric: Metric; onMetric: (metric: Metric) => void}) {
	return (
		<Tabs
			value={props.metric}
			onValueChange={value =>
				props.onMetric(Boolean.match(value === 'tokens', {onFalse: () => 'cost', onTrue: () => 'tokens'}))
			}
		>
			<TabsList aria-label="Measure">
				<TabsTrigger value="cost">Cost</TabsTrigger>
				<TabsTrigger value="tokens">Tokens</TabsTrigger>
			</TabsList>
		</Tabs>
	)
}

// The whole row is one button: it narrows the page or runs its action; a context menu, when given, holds the rest.
function Row(props: {
	button?: boolean
	children: ReactNode
	label: string
	menu?: ReactNode
	onClick: () => void
	selected?: boolean
	trailing?: ReactNode
}) {
	return (
		<div role="listitem">
			<ContextMenu disabled={props.menu === undefined}>
				<ContextMenuTrigger
					render={
						<Item
							size="row"
							data-selected={props.selected}
							aria-label={props.label}
							aria-pressed={props.selected}
							render={Boolean.match(props.button === false, {
								onFalse: () => <button type="button" aria-label={props.label} onClick={props.onClick} />,
								onTrue: () => <div />
							})}
						/>
					}
				>
					{props.children}
					{props.trailing !== undefined && <ItemActions>{props.trailing}</ItemActions>}
				</ContextMenuTrigger>
				{props.menu !== undefined && <ContextMenuContent className="w-auto min-w-36">{props.menu}</ContextMenuContent>}
			</ContextMenu>
		</div>
	)
}

// Swatch, name, share of the shown total, tokens and cost: the same columns in both breakdowns; models keep the slot but carry no swatch.
function ShareRow(props: {
	color?: string
	label: string
	menu?: ReactNode
	onClick: () => void
	selected: boolean
	share: number
	sum: Option.Option<Sum>
}) {
	return (
		<Row
			label={props.label}
			menu={props.menu}
			onClick={props.onClick}
			selected={props.selected}
			trailing={
				<>
					<span className="text-muted-foreground w-12 shrink-0 text-right font-mono text-xs tabular-nums">
						{Number.round(props.share * 100, 0)}%
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
				</>
			}
		>
			<ItemMedia>
				<span className="flex w-4 items-center justify-center">
					{props.color !== undefined && (
						<span className="size-2.5 bg-(--swatch-color)" style={{'--swatch-color': props.color}} />
					)}
				</span>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.label}</ItemTitle>
			</ItemContent>
		</Row>
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
		<ChartContainer config={config} className="h-40 w-full">
			<BarChart
				accessibilityLayer
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
			</BarChart>
		</ChartContainer>
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
				<div className="flex px-4 pt-3">
					<Button variant="secondary" size="xs" aria-label={`Show all, not only ${text}`} onClick={props.onClear}>
						{text}
						<XIcon data-icon="inline-end" />
					</Button>
				</div>
			)
		}
	)
}

// The period at a glance, with the measure it charts by.
function Totals(props: {metric: Metric; onMetric: (metric: Metric) => void; report: AiUsageReport}) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4">
			<span className="text-2xl font-medium tabular-nums">{cost(props.report.totals.costUsd)}</span>
			<Stat label="tokens" value={compact.format(props.report.totals.tokens)} />
			<Stat label="calls" value={count.format(props.report.totals.calls)} />
			<div className="ml-auto">
				<MetricTabs metric={props.metric} onMetric={props.onMetric} />
			</div>
		</div>
	)
}

function UsageReport(props: {
	focus: Focus
	metric: Metric
	onFocus: (focus: Focus) => void
	onMetric: (metric: Metric) => void
	period: Period
	range: Range
	report: AiUsageReport
}) {
	if (Array.isReadonlyArrayEmpty(props.report.cells)) {
		return (
			<EmptyState
				label={`No AI calls in the ${Option.getOrElse(
					Option.map(
						Array.findFirst(PERIODS, entry => entry.value === props.period),
						entry => entry.name
					),
					() => 'period'
				)}`}
				icon={<SparkleIcon className="size-5" weight="light" />}
			/>
		)
	}
	const value = measure(props.metric)
	const byMetric = Order.flip(Order.mapInput(Order.Number, value))
	const allApps = Array.sort(
		sums(props.report.cells, cell => cell.app),
		byMetric
	)
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
	function toggle(next: Focus) {
		const same =
			(next.app !== undefined && next.app === props.focus.app) ||
			(next.model !== undefined && next.model === props.focus.model) ||
			(next.bucket !== undefined && next.bucket === props.focus.bucket)
		props.onFocus(Boolean.match(same, {onFalse: () => next, onTrue: () => ({})}))
	}
	return (
		<Card>
			<div className="flex flex-col">
				<Totals metric={props.metric} onMetric={props.onMetric} report={props.report} />
				<div className="px-4 pt-3">
					<UsageChart
						apps={Array.map(allApps, (sum, index) => ({app: sum.name, color: colorOf(sum.name), key: `app${index}`}))}
						metric={props.metric}
						onBucket={at => toggle({bucket: at})}
						range={props.range}
						report={props.report}
					/>
				</div>
				<FocusChip focus={props.focus} bucket={props.range.bucket} onClear={() => props.onFocus({})} />
				<div className="mt-3 border-t">
					<ItemListHeading icon={<SquaresFourIcon />}>Apps</ItemListHeading>
					<div role="list" aria-label="By app">
						{Array.map(appSums, sum => (
							<ShareRow
								key={sum.name}
								color={colorOf(sum.name)}
								label={appName(sum.name)}
								onClick={() => toggle({app: sum.name})}
								selected={props.focus.app === sum.name}
								share={share(value(sum), appTotal)}
								sum={Option.some(sum)}
							/>
						))}
					</div>
					{Array.isReadonlyArrayNonEmpty(modelSums) && (
						<>
							<ItemListHeading icon={<CubeIcon />}>Models</ItemListHeading>
							<div role="list" aria-label="By model">
								{Array.map(modelSums, sum => (
									<ShareRow
										key={sum.name}
										label={sum.name}
										onClick={() => toggle({model: sum.name})}
										selected={props.focus.model === sum.name}
										share={share(value(sum), modelTotal)}
										sum={Option.some(sum)}
									/>
								))}
							</div>
						</>
					)}
				</div>
			</div>
		</Card>
	)
}

// judge-ignore no-dropped-content -- a period's usage loads once; only this failure's Retry reloads it, so nothing loaded can drop.
function Usage(props: {
	focus: Focus
	metric: Metric
	onFocus: (focus: Focus) => void
	onMetric: (metric: Metric) => void
	period: Period
}) {
	const result = useAtomSuspense(aiUsageAtom(props.period), {includeFailure: true})
	const refresh = useAtomRefresh(aiUsageAtom(props.period))
	if (AsyncResult.isFailure(result)) return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	return <UsageReport {...props} range={result.value.range} report={result.value.report} />
}

// A provider's key by its last four, what it cost in the period and a red dot once the provider refused it.
function KeyRow(props: {
	info: Option.Option<AiKeyInfo>
	onAdd: () => void
	onRemove: () => void
	provider: AiProvider
	spent: string
}) {
	const rejected = Option.exists(props.info, info => info.lastStatus === 401 || info.lastStatus === 403)
	const last4 = Option.map(props.info, info => `••••${info.last4}`)
	return (
		<Row
			button={Option.isSome(props.info)}
			label={`${PROVIDER_NAMES[props.provider]}, ${Option.getOrElse(last4, () => 'no key')}`}
			onClick={props.onAdd}
			menu={Option.match(props.info, {
				onNone: () => undefined,
				onSome: () => (
					<>
						<ContextMenuItem className="max-sm:h-11" onClick={props.onAdd}>
							Replace key
						</ContextMenuItem>
						<ContextMenuItem variant="destructive" className="max-sm:h-11" onClick={props.onRemove}>
							Remove key
						</ContextMenuItem>
					</>
				)
			})}
			trailing={Option.match(props.info, {
				onNone: () => (
					<Button
						variant="secondary"
						size="xs"
						aria-label={`Add ${PROVIDER_NAMES[props.provider]} key`}
						onClick={event => {
							event.stopPropagation()
							props.onAdd()
						}}
					>
						<PlusIcon />
						Add key
					</Button>
				),
				onSome: () => (
					<>
						{rejected && <StatusDot status="error" />}
						<span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">{props.spent}</span>
					</>
				)
			})}
		>
			<ItemMedia>
				<KeyIcon className="text-muted-foreground size-4" />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					<span
						className={cn(
							'truncate',
							Boolean.match(Option.isNone(props.info), {
								onFalse: () => undefined,
								onTrue: () => 'text-muted-foreground'
							})
						)}
					>
						{PROVIDER_NAMES[props.provider]}
					</span>
					{Option.match(last4, {
						onNone: () => null,
						onSome: value => <span className="text-muted-foreground font-mono text-xs">{value}</span>
					})}
				</ItemTitle>
			</ItemContent>
		</Row>
	)
}

function Keys(props: {onAdd: (provider: Option.Option<AiProvider>) => void; period: Period}) {
	const result = useAtomSuspense(aiKeysAtom, {includeFailure: true})
	const usage = useAtomValue(aiUsageAtom(props.period))
	const [removal, removeKey] = useAtom(removeKeyAtom)
	if (AsyncResult.isFailure(result)) {
		if (Option.exists(AsyncResult.error(result), isDenied)) return null
		return (
			<div className="px-4">
				<ResultError result={result} />
			</div>
		)
	}
	const byProvider = AsyncResult.getOrElse(
		AsyncResult.map(usage, value => value.report.byProvider),
		() => []
	)
	return (
		<>
			<Card>
				<div role="list" aria-label="Keys">
					{Array.map(PROVIDERS, provider => (
						<KeyRow
							key={provider}
							provider={provider}
							info={Array.findFirst(result.value, key => key.provider === provider)}
							onAdd={() => props.onAdd(Option.some(provider))}
							onRemove={() => removeKey(provider)}
							spent={Option.getOrElse(
								Option.map(
									Array.findFirst(byProvider, entry => entry.name === provider),
									costOf
								),
								() => '—'
							)}
						/>
					))}
				</div>
			</Card>
			<div className="px-4">
				<ResultError result={removal} />
			</div>
		</>
	)
}

export function AiPane(props: {
	focus: Focus
	metric: Metric
	onAdd: (provider: Option.Option<AiProvider>) => void
	onFocus: (focus: Focus) => void
	onMetric: (metric: Metric) => void
	period: Period
}) {
	return (
		<CatchBoundary getResetKey={() => `ai-${props.period}`} errorComponent={FailureContent}>
			<Suspense
				fallback={
					<Card>
						<ItemListSkeleton label="AI usage" media rows={6} />
					</Card>
				}
			>
				<Usage
					focus={props.focus}
					metric={props.metric}
					onFocus={props.onFocus}
					onMetric={props.onMetric}
					period={props.period}
				/>
			</Suspense>
			<Suspense
				fallback={
					<Card>
						<ItemListSkeleton label="Keys" media rows={4} />
					</Card>
				}
			>
				<Keys onAdd={props.onAdd} period={props.period} />
			</Suspense>
		</CatchBoundary>
	)
}

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
