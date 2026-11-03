import {useAtom, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Function, Match, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {ChevronRight, Play} from 'lucide-react'
import {useState, useTransition} from 'react'
import type {ReactNode} from 'react'

import {useCommandQuery} from '@deslop/components-web/app-bar'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Alert, AlertDescription, AlertTitle} from '@deslop/components-web/ui/alert'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@deslop/components-web/ui/collapsible'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {cn} from '@deslop/components-web/utils'
import {AuthError} from '@deslop/runtime/auth/schema'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {hideAtom, inventoryAtom, metricsAtom, runAtom} from '#lib/utils.ts'
import {RANGES} from '#routes/(home)/-chart.ts'
import {Cores, TimeAxis, UsageChart} from '#routes/(home)/-charts.tsx'
import {PageError} from '#routes/(home)/-error.tsx'
import {useExpose} from '#routes/(home)/-expose.tsx'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {appUsage, processTree} from '#routes/(home)/-process-tree.ts'
import {Processes} from '#routes/(home)/-processes.tsx'
import {bands} from '#routes/(home)/-usage.ts'
import type {Band} from '#routes/(home)/-usage.ts'
import {availablePorts, itemOwner, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, Process} from '#services/inventory/schema.ts'
import type {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'

function status(item: InventoryItem) {
	if (String.startsWith('stale')(item.state)) return 'stale'
	if (String.includes('unhealthy')(item.detail)) return 'unhealthy'
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && item.owned === true) return 'configured'
	if (item.kind === 'exposure' && item.publicAccess === true) return 'public permission'
	return String.replace(/^active · /u, '')(String.toLowerCase(item.state))
}

function dot(item: InventoryItem, state: string) {
	if (Option.isSome(String.match(/failed|unhealthy|Exited \([1-9]/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission' || state === 'restarting') return 'warning'
	if (Option.isSome(String.match(/running|online|listening|activating/u)(state))) return 'live'
	return 'quiet'
}

function hideTarget(item: InventoryItem) {
	if (String.startsWith('remote:')(item.id)) return item.worker
	return ''
}

// An exposed endpoint fills with the machine's hue, apart from a hairline port nobody reaches; a public one reads as its hostname.
function Endpoint(props: {item: InventoryItem}) {
	return (
		<Badge
			variant="default"
			className="relative max-w-48 shrink-0 font-mono"
			render={
				<a
					href={props.item.url}
					aria-label={`${Boolean.match(props.item.publicAccess === true, {onFalse: () => 'Tailnet', onTrue: () => 'Public'})} ${props.item.url}`}
					target="_blank"
					rel="noreferrer"
					title={props.item.url}
				/>
			}
		>
			<span className="truncate">
				{Boolean.match(props.item.publicAccess === true, {
					onFalse: () => `:${props.item.port}`,
					onTrue: () => String.replace(/^https:\/\//u, '')(props.item.url)
				})}
			</span>
		</Badge>
	)
}

// A timer's job, started now from where other rows keep their chevron; its failure shows on the row.
function RunNow(props: {busy: boolean; item: InventoryItem; onRun: () => void}) {
	const [result, run] = useAtom(runAtom(props.item.id))
	const working = props.busy || AsyncResult.isWaiting(result)
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			className="relative shrink-0"
			aria-label={Boolean.match(working, {
				onFalse: () => `Run ${workloadName(props.item)} now`,
				onTrue: () => `${workloadName(props.item)} is running`
			})}
			title={Boolean.match(working, {onFalse: () => 'Run now', onTrue: () => 'Running'})}
			disabled={working}
			onClick={() => {
				props.onRun()
				run({
					name: props.item.name,
					scope: props.item.scope ?? 'system',
					...Boolean.match(String.startsWith('remote:')(props.item.id), {
						onFalse: () => ({}),
						onTrue: () => ({target: props.item.worker})
					})
				})
			}}
		>
			{Boolean.match(working, {onFalse: () => <Play />, onTrue: () => <Spinner />})}
		</Button>
	)
}

function RunFailure(props: {item: InventoryItem}) {
	return <ResultError result={useAtomValue(runAtom(props.item.id))} className="wrap-anywhere" />
}

// The row's menu item for one exposure this app made; its failure shows on the row.
function RemoveExposure(props: {item: InventoryItem}) {
	const [result, hide] = useAtom(hideAtom(hideTarget(props.item))(props.item.name))
	return (
		<ContextMenuItem variant="destructive" disabled={AsyncResult.isWaiting(result)} onClick={() => hide()}>
			Remove {String.replace(/^https:\/\//u, '')(props.item.url)}
		</ContextMenuItem>
	)
}

function RemoveFailure(props: {item: InventoryItem}) {
	return (
		<ResultError result={useAtomValue(hideAtom(hideTarget(props.item))(props.item.name))} className="wrap-anywhere" />
	)
}

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})

// When a timer next starts the job, against the snapshot's clock: minutes within the hour, then hours.
function nextRun(next: number, now: number) {
	const minutes = Number.max(0, Number.round((next - now) / 60_000, 0))
	if (minutes < 60) return untilNext.format(minutes, 'minute')
	return untilNext.format(Number.round(minutes / 60, 0), 'hour')
}

// How long ago a service stopped: minutes within the hour, hours within two days, then days.
function since(at: number, now: number) {
	const minutes = Number.max(0, Number.round((now - at) / 60_000, 0))
	if (minutes < 60) return untilNext.format(-minutes, 'minute')
	if (minutes < 2880) return untilNext.format(-Number.round(minutes / 60, 0), 'hour')
	return untilNext.format(-Number.round(minutes / 1440, 0), 'day')
}

// The key a service or container's usage history is recorded under; loose ports have none.
function owner(row: ReturnType<typeof workloads>[number]) {
	return Option.map(
		Option.liftPredicate(row.item, item => item.kind === 'service' || item.kind === 'container'),
		itemOwner
	)
}

// The band a row's usage sits in: its own, or the small apps' together.
function rowBand(row: ReturnType<typeof workloads>[number], all: readonly Band[]) {
	return Option.getOrUndefined(
		Option.flatMap(owner(row), id =>
			Option.orElse(
				Array.findFirst(all, band => band.id === id),
				() =>
					Array.findFirst(all, band => band.kind === 'other' && Array.isReadonlyArrayNonEmpty(row.item.processes ?? []))
			)
		)
	)
}

// One line per app: mark, name, endpoints, its colour in the charts and its light; the reason it needs a look replaces nothing and sits below.
function AppRow(props: {
	band?: Band
	free: readonly InventoryItem[]
	hovered: boolean
	now: number
	onHover: (id?: string) => void
	processMatch: boolean
	row: ReturnType<typeof workloads>[number]
}) {
	const [open, setOpen] = useState(false)
	const state = status(props.row.item)
	const light = dot(props.row.item, state)
	const processes = props.row.item.processes ?? []
	const tree = processTree(processes)
	const owned = Array.filter(props.row.exposures, exposure => exposure.owned === true)
	const expose = useExpose()
	// A job reads as running from its click until the inventory shows it start, and while systemd says it runs.
	const [requested, setRequested] = useState(() => Option.none<number>())
	const running =
		Option.isSome(String.match(/^(?:activating|deactivating|active · running)/u)(props.row.item.state)) ||
		Option.exists(requested, at => props.now - at < 10_000)
	const expanded = open || props.processMatch
	return (
		<Collapsible role="listitem" className="border-b" open={expanded} onOpenChange={setOpen}>
			<ContextMenu disabled={Array.isArrayEmpty(owned)}>
				{/* Right-click or long-press removes an endpoint this app exposed. */}
				<ContextMenuTrigger
					render={
						<div
							data-hovered={props.hovered}
							className="data-[hovered=true]:bg-muted/50 relative flex h-10 min-w-0 items-center gap-2 px-1"
							onPointerEnter={() => props.onHover(props.band?.id)}
							onPointerLeave={() => props.onHover()}
						/>
					}
				>
					<ApplicationIcon
						name={workloadName(props.row.item)}
						process={Option.getOrUndefined(
							Option.map(
								Array.head(
									Array.sort(
										processes,
										Order.mapInput(Order.flip(Order.Number), (process: Process) => process.memory)
									)
								),
								process => process.name
							)
						)}
						container={props.row.item.kind === 'container'}
					/>
					<span
						className={cn(
							'min-w-0 truncate text-sm font-medium',
							props.row.item.scheduled === true && 'text-muted-foreground'
						)}
						title={props.row.item.name}
					>
						{workloadName(props.row.item)}
					</span>
					{/* The whole line opens the processes; the endpoint links sit above it as their own controls. */}
					{Array.isArrayNonEmpty(tree) && (
						<CollapsibleTrigger
							aria-label={`Processes of ${workloadName(props.row.item)}`}
							className="absolute inset-0 cursor-pointer"
						/>
					)}
					<span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
						{/* A port nobody reaches yet is a hairline badge; one that can be exposed opens its dialog. */}
						{Array.map(
							Array.dedupeWith(
								Array.filter(
									props.row.listeners,
									listener =>
										listener.address !== 'container' &&
										!Array.some(props.row.exposures, exposure => exposure.port === listener.port)
								),
								(first: InventoryItem, second: InventoryItem) => first.port === second.port
							),
							listener =>
								Option.match(
									Array.findFirst(props.free, port => port.id === listener.id),
									{
										onNone: () => (
											<Badge key={listener.id} variant="outline" className="shrink-0 font-mono">
												:{listener.port}
											</Badge>
										),
										onSome: port => (
											<Badge
												key={listener.id}
												variant="outline"
												className="relative shrink-0 font-mono"
												render={
													<button
														type="button"
														aria-label={`Expose ${workloadName(props.row.item)} :${listener.port}`}
														onClick={() => expose(port)}
													/>
												}
											>
												:{listener.port}
											</Badge>
										)
									}
								)
						)}
						{Array.map(props.row.exposures, exposure => (
							<Endpoint key={exposure.id} item={exposure} />
						))}
					</span>
					{(props.row.item.next !== undefined || running) && (
						<span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
							{Boolean.match(running, {
								onFalse: () => nextRun(props.row.item.next ?? props.now, props.now),
								onTrue: () => 'running'
							})}
						</span>
					)}
					{props.band !== undefined && (
						<span
							aria-hidden="true"
							className={cn(
								'size-2 shrink-0 opacity-(--shade)',
								Boolean.match(props.band.kind === 'app', {
									onFalse: () => 'bg-muted-foreground',
									onTrue: () => 'bg-(--machine)'
								})
							)}
							style={{'--shade': `${Number.max(0.5, props.band.opacity)}`}}
						/>
					)}
					<span
						title={state}
						aria-label={state}
						role="img"
						className="flex size-3 shrink-0 items-center justify-center"
					>
						<StatusDot status={light} />
					</span>
					{Boolean.match(props.row.item.scheduled === true, {
						onFalse: () => (
							<span
								aria-hidden="true"
								className="text-muted-foreground flex size-4 shrink-0 items-center justify-center"
							>
								{Array.isArrayNonEmpty(tree) && (
									<ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
								)}
							</span>
						),
						onTrue: () => (
							<RunNow busy={running} item={props.row.item} onRun={() => setRequested(Option.some(props.now))} />
						)
					})}
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					{Array.map(owned, exposure => (
						<RemoveExposure key={exposure.id} item={exposure} />
					))}
				</ContextMenuContent>
			</ContextMenu>
			<div className="pl-8 empty:hidden">
				{(light === 'error' || light === 'warning') && (
					<p
						className={cn(
							'pb-2 text-xs wrap-anywhere',
							Boolean.match(light === 'error', {onFalse: () => 'text-warning', onTrue: () => 'text-destructive'})
						)}
					>
						{Option.match(Option.fromUndefinedOr(props.row.item.failure), {
							onNone: () => props.row.item.detail,
							onSome: stop =>
								Option.match(Option.fromUndefinedOr(stop.at), {
									onNone: () => stop.reason,
									onSome: at => `${stop.reason} · ${since(at, props.now)}`
								})
						})}
					</p>
				)}
				{props.row.item.scheduled === true && <RunFailure item={props.row.item} />}
				{Array.map(owned, exposure => (
					<RemoveFailure key={exposure.id} item={exposure} />
				))}
			</div>
			<CollapsibleContent>
				<Processes appMemory={appUsage(processes).memory} tree={tree} />
			</CollapsibleContent>
		</Collapsible>
	)
}

// An app or job in trouble leads; then the apps, heaviest first; what a timer starts, such as an updater, follows the apps it serves.
const order = Order.combine(
	Order.combine(
		Order.mapInput(Order.Number, (row: ReturnType<typeof workloads>[number]) =>
			pipe(
				Match.value(dot(row.item, status(row.item))),
				Match.when('error', () => 0),
				Match.when('warning', () => 1),
				Match.orElse(() => 2)
			)
		),
		Order.mapInput(Order.Boolean, (row: ReturnType<typeof workloads>[number]) => row.item.scheduled === true)
	),
	Order.mapInput(
		Order.flip(Order.Number),
		(row: ReturnType<typeof workloads>[number]) => appUsage(row.item.processes ?? []).memory
	)
)

function text(row: ReturnType<typeof workloads>[number]) {
	return String.toLowerCase(
		`${row.item.worker} ${row.item.name} ${Array.join(
			Array.map(row.listeners, listener => `${listener.port}`),
			' '
		)} ${Array.join(
			Array.map(row.exposures, exposure => exposure.url),
			' '
		)}`
	)
}

// The bar's field matches an app by its machine, name, ports, endpoints or any of its processes.
function matches(row: ReturnType<typeof workloads>[number], query: string) {
	return String.includes(String.toLowerCase(query))(
		`${text(row)} ${String.toLowerCase(
			Array.join(
				Array.map(row.item.processes ?? [], process => process.name),
				' '
			)
		)}`
	)
}

const size = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1})

function bytes(value: number) {
	if (value >= 1024 ** 4) return `${size.format(value / 1024 ** 4)} TiB`
	return `${size.format(value / 1024 ** 3)} GiB`
}

function Range(props: {
	minutes: HistoryQuery['minutes']
	pending: boolean
	onChange: (minutes: HistoryQuery['minutes']) => void
}) {
	return (
		<ToggleGroup
			aria-label="History range"
			className="ml-auto"
			disabled={props.pending}
			value={[`${props.minutes}`]}
			onValueChange={values =>
				Option.map(
					Array.findFirst(RANGES, range => `${range.minutes}` === values[0]),
					range => props.onChange(range.minutes)
				)
			}
		>
			{Array.map(RANGES, range => (
				<ToggleGroupItem key={range.minutes} value={`${range.minutes}`}>
					{range.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	)
}

// A machine: what it is, how its memory, CPU and cores were used over the range, then its apps; hovering an app lights its band and back.
function Machine(props: {
	available: 'checking' | 'live' | 'off'
	history?: MachineHistory
	minutes: HistoryQuery['minutes']
	now: number
	query: string
	free: readonly InventoryItem[]
	range?: ReactNode
	rows: readonly ReturnType<typeof workloads>[number][]
	worker: string
}) {
	const [hovered, setHovered] = useState<string>()
	const latest = Option.getOrUndefined(Array.last(props.history?.samples ?? []))
	const all = Option.match(Option.fromUndefinedOr(props.history), {onNone: () => [], onSome: bands})
	const names = Record.fromEntries([
		...Array.getSomes(
			Array.map(props.rows, row => Option.map(owner(row), id => [id, workloadName(row.item)] as const))
		),
		['other', 'Small apps'] as const,
		['system', 'System'] as const
	])
	// A stopped app keeps its band with no row to name it, so it reads as its unit or container.
	function bandName(id: string) {
		return (
			names[id] ??
			String.replaceAll(
				/^service:[a-z]+:(?:deslop-)?|\.service$/gu,
				''
			)(String.replace(/^container:/u, 'container ')(id))
		)
	}
	const storage = {
		total: Array.reduce(latest?.disks ?? [], 0, (sum, disk) => sum + disk.total),
		used: Array.reduce(latest?.disks ?? [], 0, (sum, disk) => sum + disk.used)
	}
	const matching = Array.filter(props.rows, row => matches(row, props.query))
	if (props.query !== '' && Array.isArrayEmpty(matching)) return null
	const sorted = Array.sort(matching, order)
	function rowProps(row: ReturnType<typeof workloads>[number]) {
		return {
			band: rowBand(row, all),
			free: props.free,
			hovered: hovered !== undefined && rowBand(row, all)?.id === hovered,
			now: props.now,
			onHover: setHovered,
			processMatch: props.query !== '' && !String.includes(String.toLowerCase(props.query))(text(row)),
			row
		}
	}
	return (
		<section
			aria-label={machineName(props.worker)}
			className="deploy-machine flex min-w-0 flex-col gap-3"
			data-machine={machineName(props.worker)}
		>
			<div className="flex h-7 min-w-0 items-center gap-2">
				<MachineIcon worker={props.worker} />
				<span className="text-sm font-semibold">{machineName(props.worker)}</span>
				{props.available !== 'live' && (
					<span
						role="img"
						className="flex size-3 items-center justify-center"
						aria-label={Boolean.match(props.available === 'checking', {
							onFalse: () => 'Unavailable',
							onTrue: () => 'Checking'
						})}
					>
						<StatusDot status="off" waiting={props.available === 'checking'} />
					</span>
				)}
				{latest !== undefined && (
					<span className="text-muted-foreground min-w-0 truncate font-mono text-xs tabular-nums">
						{Array.join(
							[
								...Boolean.match(Array.isReadonlyArrayNonEmpty(latest.cores ?? []), {
									onFalse: () => [],
									onTrue: () => [`${latest.cores?.length} cores`]
								}),
								bytes(latest.memoryTotal),
								...Boolean.match(storage.total > 0, {onFalse: () => [], onTrue: () => [`${bytes(storage.total)} disk`]})
							],
							' · '
						)}
					</span>
				)}
				{props.range}
			</div>
			{props.history !== undefined && latest !== undefined && props.query === '' && (
				<div className={cn('flex flex-col gap-3', props.history.stale && 'opacity-50')}>
					<UsageChart
						history={props.history}
						minutes={props.minutes}
						hovered={hovered}
						label="Memory"
						layers={Array.map(all, band => ({...band, values: band.memory}))}
						names={bandName}
						onHover={setHovered}
						recorded={Function.constTrue}
					/>
					<UsageChart
						history={props.history}
						minutes={props.minutes}
						hovered={hovered}
						label="CPU"
						layers={Array.map(all, band => ({...band, values: band.cpu}))}
						names={bandName}
						onHover={setHovered}
						recorded={sample => sample.cpu !== undefined}
					/>
					{storage.total > 0 && (
						<UsageChart
							history={props.history}
							minutes={props.minutes}
							label="Disk"
							layers={[
								{
									id: 'disk',
									kind: 'app',
									opacity: 0.6,
									// Older points keep only their used total; the size is the latest one's.
									values: Array.map(
										props.history.samples,
										sample =>
											((sample.storageUsed ?? Array.reduce(sample.disks, 0, (sum, disk) => sum + disk.used)) /
												storage.total) *
											100
									)
								}
							]}
							names={() => `${bytes(storage.used)} of ${bytes(storage.total)} used`}
							onHover={Function.constVoid}
							recorded={Function.constTrue}
						/>
					)}
					<TimeAxis history={props.history} minutes={props.minutes} />
					<Cores history={props.history} minutes={props.minutes} />
				</div>
			)}
			<div role="list">
				{Array.map(sorted, row => (
					<AppRow key={`${row.item.id}:${props.query !== ''}`} {...rowProps(row)} />
				))}
			</div>
		</section>
	)
}

// A failure's own message for an alert, not its trace.
function failure(cause: Cause.Cause<{message: string}>) {
	return Option.match(Cause.findErrorOption(cause), {
		onNone: () => 'Something went wrong',
		onSome: error => error.message
	})
}

function Fleet() {
	const [minutes, setMinutes] = useState<HistoryQuery['minutes']>(60)
	const [pending, transition] = useTransition()
	const query = useCommandQuery()
	const inventory = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const snapshot = AsyncResult.value(inventory)
	if (
		AsyncResult.isFailure(inventory) &&
		(Option.isNone(snapshot) || Option.exists(Cause.findErrorOption(inventory.cause), Schema.is(AuthError)))
	) {
		throw Cause.squash(inventory.cause)
	}
	const value = Option.getOrThrow(snapshot)
	const recorded = useAtomSuspense(metricsAtom(minutes), {includeFailure: true})
	const metrics = Option.getOrElse(AsyncResult.value(recorded), () => [])
	const rows = workloads(value.items)
	const workers = Array.dedupe([
		...(value.workers ?? Array.map(value.items, item => item.worker)),
		...Array.map(metrics, machine => machine.worker)
	])
	return (
		<div className="pb-safe flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pr-3" aria-busy={pending}>
			{AsyncResult.isFailure(inventory) && (
				<Alert variant="destructive">
					<AlertTitle>Apps may be out of date</AlertTitle>
					<AlertDescription className="wrap-anywhere">{failure(inventory.cause)}</AlertDescription>
				</Alert>
			)}
			{AsyncResult.isFailure(recorded) && (
				<Alert variant="destructive">
					<AlertTitle>Usage history is unavailable</AlertTitle>
					<AlertDescription className="wrap-anywhere">{failure(recorded.cause)}</AlertDescription>
				</Alert>
			)}
			{Array.map(
				Array.filter(value.sources, source => source.error !== '' && !Array.contains(value.workers ?? [], source.name)),
				source => (
					<Alert key={source.name} variant="destructive">
						<AlertTitle>{source.name} is unreachable</AlertTitle>
						<AlertDescription className="wrap-anywhere">{source.error}</AlertDescription>
					</Alert>
				)
			)}
			{Array.map(workers, (worker, index) => {
				const history = Option.getOrUndefined(
					Array.findFirst(
						metrics,
						machine => machine.worker === worker && Array.isReadonlyArrayNonEmpty(machine.samples)
					)
				)
				const failed =
					AsyncResult.isFailure(inventory) ||
					history?.stale === true ||
					Array.some(value.sources, source => source.name === worker && source.error !== '')
				return (
					<Machine
						key={worker}
						worker={worker}
						// A remote worker reads as checking until its first answer arrives.
						available={Boolean.match(
							index !== 0 &&
								!failed &&
								!Array.some(value.sources, source => String.startsWith(`${worker} · `)(source.name)),
							{
								onFalse: () => Boolean.match(failed, {onFalse: () => 'live' as const, onTrue: () => 'off' as const}),
								onTrue: () => 'checking' as const
							}
						)}
						free={availablePorts(value.items)}
						history={history}
						minutes={minutes}
						now={value.time}
						query={query}
						rows={Array.filter(rows, row => row.item.worker === worker)}
						range={
							index === 0 && (
								<Range minutes={minutes} pending={pending} onChange={next => transition(() => setMinutes(next))} />
							)
						}
					/>
				)
			})}
			{!Array.some(rows, row => matches(row, query)) && (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No app matches</EmptyTitle>
					</EmptyHeader>
				</Empty>
			)}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Fleet, errorComponent: PageError})
