import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {
	DateTime,
	Array,
	Boolean,
	Equal,
	Filter,
	Function,
	HashSet,
	Match,
	Number,
	Option,
	Order,
	Record,
	String,
	pipe
} from 'effect'

import {AppWindowIcon, PlayIcon} from '@phosphor-icons/react'
import {CatchBoundary} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {ResultError} from '@deslop/components-web/blocks/result-error'
import {ChoiceRow, LoadingRows, RowLines, RowMark} from '@deslop/components-web/blocks/rows'
import {Sparkline} from '@deslop/components-web/blocks/sparkline'
import {Loaded, ReadFailure} from '@deslop/components-web/blocks/states'
import {StatusDot} from '@deslop/components-web/blocks/status-dot'
import {cn} from '@deslop/components-web/lib/utils'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {ScrollArea} from '@deslop/components-web/ui/scroll-area'
import {Table, TableBody, TableCell} from '@deslop/components-web/ui/table'
import {clockAtom} from '@deslop/runtime/client/clock'
import {bytesOf, dueOf, percentOf, timerOf} from '@deslop/runtime/shared/format'

import {inventoryAtom, openExposeAtom, runAtom} from '#lib/machine.ts'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {host, impactGroups, middleEllipsis, owner} from '#routes/(home)/-rows.ts'
import type {Usage} from '#routes/(home)/-usage.ts'
import {failureAge, reasonLine, reasonOf, requestOf, type Row, workloadName} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, ItemId, Process} from '#services/inventory/schema.ts'

export function InventoryContent(props: {children: ReactNode}) {
	return (
		<Loaded atom={inventoryAtom}>
			{() => (
				<CatchBoundary getResetKey={Function.constant('inventory')} errorComponent={ReadFailure}>
					{props.children}
				</CatchBoundary>
			)}
		</Loaded>
	)
}

// An app's ports and addresses, each a piece of the row's muted line: a free listening port is the text that opens the Expose dialog, a port already exposed is its link's own text with the address, and the rest is plain. A public Funnel mapping shows beside the saved private exposure of the same port.
function endpointsOf(free: readonly InventoryItem[], row: Row, expose: (port: InventoryItem) => void) {
	const exposedPorts = HashSet.fromIterable(Array.getSomes(Array.map(row.exposures, exposure => exposure.port)))
	const freePorts = Array.groupBy(free, port => port.id)
	return [
		...Array.map(
			pipe(
				row.listeners,
				Array.filter(
					listener =>
						!Option.contains(listener.address, 'container') &&
						!Option.exists(listener.port, port => HashSet.has(exposedPorts, port))
				),
				Array.dedupeWith((first: InventoryItem, second: InventoryItem) => Equal.equals(first.port, second.port))
			),
			listener =>
				Option.match(Array.head(freePorts[listener.id] ?? []), {
					onNone: () => (
						<span key={listener.id} className="px-2">
							:{Option.getOrUndefined(listener.port)}
						</span>
					),
					onSome: port => (
						<Badge
							key={listener.id}
							variant="ghost"
							render={
								<button
									type="button"
									aria-label={`Expose ${workloadName(row.item)} :${Option.getOrUndefined(listener.port)}`}
									onClick={() => expose(port)}
								/>
							}
						>
							:{Option.getOrUndefined(listener.port)}
						</Badge>
					)
				})
		),
		...Array.map(row.exposures, exposure => (
			<Badge
				key={exposure.id}
				variant="ghost"
				className="max-w-full"
				render={
					<a
						href={Option.getOrUndefined(exposure.url)}
						target="_blank"
						rel="noreferrer"
						title={Option.getOrUndefined(exposure.url)}
						aria-label={`Open ${Option.getOrUndefined(exposure.url)}`}
					/>
				}
			>
				{exposure.health !== 'quiet' && <StatusDot status={exposure.health} label={reasonOf(exposure)} />}
				<span className="truncate">
					{Array.join(
						Array.getSomes([
							pipe(
								exposure.port,
								Option.map(port => `:${port}`),
								Option.filter(port => !Option.exists(exposure.url, url => String.endsWith(port)(host(url))))
							),
							Option.map(exposure.url, host)
						]),
						' · '
					)}
				</span>
			</Badge>
		))
	]
}

// A running job's time: it starts counting when its row shows it, once a second, in the column that shows the next start.
const elapsedAtom = Atom.family((_job: ItemId) => {
	const sinceAtom = Atom.make(get => get.once(clockAtom('1 second')))
	return Atom.make(get => DateTime.distance(get(sinceAtom), get(clockAtom('1 second'))))
})

function Elapsed(props: {job: ItemId}) {
	return <span className="text-muted-foreground tabular-nums">{timerOf(useAtomValue(elapsedAtom(props.job)))}</span>
}

// A timer's job, started now at its row's end; it waits, disabled, while the job runs.
function RunNow(props: {disabled: boolean; item: InventoryItem; onRun: () => void}) {
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			disabled={props.disabled}
			aria-label={`Run ${workloadName(props.item)} now`}
			onClick={props.onRun}
		>
			<PlayIcon />
		</Button>
	)
}

function RunFailure(props: {item: InventoryItem}) {
	return <ResultError result={useAtomValue(runAtom(props.item.id))} />
}

// A figure at the row's trailing edge, a dash where the range recorded the app without a reading in its latest sample.
function Figure(props: {children: ReactNode}) {
	return (
		<TableCell className="text-right">
			<span className="text-muted-foreground in-data-[state=selected]:text-foreground tabular-nums">
				{props.children}
			</span>
		</TableCell>
	)
}

// One app or job: its mark, name, and one muted line with its ports and addresses or, when it needs a look, a dot and why; then its CPU line, CPU and memory, or a job's time and Run now. The whole row opens its processes.
function AppRow(props: {
	compact: boolean
	free: readonly InventoryItem[]
	now: DateTime.Utc
	onSelect: () => void
	row: Row
	selected: boolean
	spark: boolean
	usage: Option.Option<Usage>
}) {
	const [runResult, run] = useAtom(runAtom(props.row.item.id))
	const expose = useAtomSet(openExposeAtom)
	const scheduled = Option.contains(props.row.item.scheduled, true)
	const age = failureAge(props.row.item, props.now)
	const running = props.row.item.running || AsyncResult.isWaiting(runResult)
	const fullName = workloadName(props.row.item)
	const name = Boolean.match(props.compact, {onFalse: () => fullName, onTrue: () => middleEllipsis(fullName)})
	const health = props.row.item.health
	const next = Boolean.match(running, {
		onFalse: () =>
			dueOf(
				Option.getOrElse(props.row.item.next, () => props.now),
				props.now
			),
		onTrue: Function.constant('')
	})
	const endpoints = endpointsOf(props.free, props.row, expose)
	const reason = Boolean.match(scheduled, {
		onFalse: () => reasonLine(props.row.item, props.now),
		onTrue: () => reasonOf(props.row.item)
	})
	const problem = pipe(
		Match.value(health),
		Match.when('quiet', Function.constant({})),
		Match.orElse(status => ({problem: {reason, status}}))
	)
	const figures = Option.flatMap(props.usage, usage =>
		Option.flatMap(owner(props.row), id => Record.get(usage.figures, id))
	)
	// The row opens its processes; its links and buttons act alone.
	return (
		<ChoiceRow label={`Open ${fullName}`} selected={props.selected} onSelect={props.onSelect}>
			<TableCell>
				<RowMark>
					<ApplicationIcon
						name={fullName}
						process={pipe(
							props.row.item.processes,
							Option.getOrElse(Array.empty<Process>),
							Array.match({
								onEmpty: () => Option.none<string>(),
								onNonEmpty: entries =>
									Option.some(
										Array.max(
											entries,
											Order.mapInput(Number.Order, (entry: Process) => entry.memory)
										).name
									)
							})
						)}
						container={props.row.item.kind === 'container'}
					/>
				</RowMark>
			</TableCell>
			<RowLines
				title={fullName}
				line={Boolean.match(scheduled, {
					onFalse: () => Array.match(endpoints, {onEmpty: Function.constUndefined, onNonEmpty: Function.identity}),
					onTrue: () => <RunFailure item={props.row.item} />
				})}
				{...problem}
			>
				{name}
			</RowLines>
			{Boolean.match(scheduled, {
				onFalse: () => (
					<>
						{props.spark && (
							<TableCell>
								{Option.match(figures, {
									onNone: Function.constNull,
									onSome: current => <Sparkline values={current.cpu} />
								})}
							</TableCell>
						)}
						{Option.match(owner(props.row), {
							onNone: () => (
								<>
									<TableCell />
									<TableCell />
								</>
							),
							onSome: () =>
								Option.match(props.usage, {
									onNone: () => (
										<>
											<TableCell />
											<TableCell />
										</>
									),
									onSome: () => (
										<>
											<Figure>
												{pipe(
													figures,
													Option.flatMap(current => current.cpuNow),
													Option.match({onNone: Function.constant('—'), onSome: percentOf})
												)}
											</Figure>
											<Figure>
												{pipe(
													figures,
													Option.flatMap(current => current.memoryNow),
													Option.match({onNone: Function.constant('—'), onSome: bytesOf})
												)}
											</Figure>
										</>
									)
								})
						})}
					</>
				),
				onTrue: () => (
					<TableCell
						colSpan={Boolean.match(props.spark, {onFalse: Function.constant(2), onTrue: Function.constant(3)})}
						className="text-right"
					>
						<span className="inline-flex items-center gap-2">
							{Boolean.match(running, {
								onFalse: () => (
									<span className="text-muted-foreground tabular-nums">
										{Boolean.match(health === 'quiet', {
											onFalse: () => Option.getOrElse(age, () => next),
											onTrue: () => next
										})}
									</span>
								),
								onTrue: () => <Elapsed job={props.row.item.id} />
							})}
							<RunNow disabled={running} item={props.row.item} onRun={() => run(requestOf(props.row.item))} />
						</span>
					</TableCell>
				)
			})}
			{/* An endpoint this app exposed is hidden through Deploy's hide_exposure tool, not this page. A failing app's reason takes its muted line, so its ports and addresses come at the row's end. */}
			{!scheduled && health !== 'quiet' && Array.isReadonlyArrayNonEmpty(endpoints) && (
				<TableCell className="text-right">
					<span className="text-muted-foreground">{endpoints}</span>
				</TableCell>
			)}
		</ChoiceRow>
	)
}

function ListRows(props: {
	compact: boolean
	free: readonly InventoryItem[]
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId: Option.Option<string>
	spark: boolean
	usage: Option.Option<Usage>
}) {
	return Array.map(props.rows, row => (
		<AppRow
			key={row.item.id}
			compact={props.compact}
			free={props.free}
			now={props.now}
			onSelect={() => props.onSelect(row)}
			row={row}
			selected={Option.contains(props.selectedId, row.item.id)}
			spark={props.spark}
			usage={props.usage}
		/>
	))
}

// The apps on one machine: failures first, then high-impact apps by memory, then healthy low-impact apps, then the jobs a timer starts.
export function ListPane(props: {
	className?: string
	compact: boolean
	free: readonly InventoryItem[]
	now: DateTime.Utc
	onSelect: (row: Row) => void
	rows: readonly Row[]
	selectedId: Option.Option<string>
	spark: boolean
	usage: Option.Option<Usage>
}) {
	const [jobs, apps] = Array.partition(
		props.rows,
		Filter.fromPredicate(row => Option.contains(row.item.scheduled, true))
	)
	const groups = impactGroups(
		apps,
		pipe(
			props.usage,
			Option.map(usage => usage.lowImpact),
			Option.getOrElse(HashSet.empty)
		)
	)
	return (
		<div className={cn('flex min-h-0 flex-col', props.className)}>
			<Suspense fallback={<LoadingRows label="Apps loading" rows={8} />}>
				<InventoryContent>
					{Array.match(props.rows, {
						onEmpty: () => (
							<Empty role="status">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<AppWindowIcon />
									</EmptyMedia>
									<EmptyTitle>No apps</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onNonEmpty: () => (
							<ScrollArea className="min-h-0 flex-1">
								<Table aria-label="Apps">
									<TableBody>
										<ListRows
											compact={props.compact}
											free={props.free}
											now={props.now}
											onSelect={props.onSelect}
											rows={[...groups.high, ...groups.low, ...jobs]}
											selectedId={props.selectedId}
											spark={props.spark}
											usage={props.usage}
										/>
									</TableBody>
								</Table>
							</ScrollArea>
						)
					})}
				</InventoryContent>
			</Suspense>
		</div>
	)
}
