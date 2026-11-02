import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, String} from 'effect'

import {createFileRoute, useSearch} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {ChevronRight, Globe, Network, Plus, X} from 'lucide-react'
import {useState} from 'react'

import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList
} from '@deslop/components-web/ui/combobox'
import {Input} from '@deslop/components-web/ui/input'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {MachineIcon} from '#lib/components.tsx'
import {exposeAtom, hideAtom, inventoryAtom} from '#lib/utils.ts'
import {PageError} from '#routes/(home)/-error.tsx'
import {ApplicationIcon} from '#routes/(home)/-marks.tsx'
import {processTree, processUsage} from '#routes/(home)/-process-tree.ts'
import {ProcessUsage, Processes} from '#routes/(home)/-processes.tsx'
import {availablePorts, portLabel, workloadName, workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'

function Expose(props: {items: readonly InventoryItem[]; choices: readonly InventoryItem[]}) {
	const [result, expose] = useAtom(exposeAtom)
	const [kind, setKind] = useState<'tailnet' | 'public'>('tailnet')
	const [selectedId, setSelectedId] = useState('')
	const [hostname, setHostname] = useState('')
	const selectedItem = Option.getOrUndefined(Array.findFirst(props.choices, item => item.id === selectedId))
	const tailnetHost = Option.getOrElse(
		Option.map(
			Array.findFirst(props.items, item => item.self === true && item.worker === selectedItem?.worker),
			item => item.hostname ?? ''
		),
		() => ''
	)
	const pending = AsyncResult.isWaiting(result)
	return (
		<form
			aria-label="Expose a port"
			className="flex flex-col gap-2 border-b pb-4"
			onSubmit={event => {
				event.preventDefault()
				if (selectedItem?.port === undefined) return
				expose({
					hostname: Boolean.match(kind === 'public', {onFalse: () => tailnetHost, onTrue: () => hostname}),
					kind,
					name: Boolean.match(kind === 'public', {
						onFalse: () => `tailnet:${selectedItem.port}`,
						onTrue: () => `public:${hostname}`
					}),
					port: selectedItem.port,
					publicAccess: kind === 'public',
					target: Boolean.match(String.startsWith('remote:')(selectedItem.id), {
						onFalse: () => '',
						onTrue: () => selectedItem.worker
					})
				})
			}}
		>
			<div className="flex items-center justify-between gap-2">
				<h1 className="text-sm font-semibold">Expose a port</h1>
				<ToggleGroup
					aria-label="Exposure visibility"
					value={[kind]}
					disabled={pending}
					onValueChange={values => {
						if (values[0] === 'public' || values[0] === 'tailnet') setKind(values[0])
					}}
				>
					<ToggleGroupItem value="tailnet">Tailnet</ToggleGroupItem>
					<ToggleGroupItem value="public">Public</ToggleGroupItem>
				</ToggleGroup>
			</div>
			<div className="flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<Combobox
						items={props.choices}
						value={selectedItem ?? null}
						itemToStringLabel={portLabel}
						isItemEqualToValue={(a, b) => a.id === b.id}
						onValueChange={item => setSelectedId(item?.id ?? '')}
						disabled={pending}
					>
						<ComboboxInput
							id="expose-port"
							aria-label="Listening port"
							placeholder="Choose an app…"
							className="w-full"
							showClear
						/>
						<ComboboxContent className="w-(--available-width) max-w-sm sm:w-(--anchor-width)">
							<ComboboxEmpty>No matching app listeners.</ComboboxEmpty>
							<ComboboxList>
								{(item: InventoryItem) => (
									<ComboboxItem key={item.id} value={item} className="pr-7">
										<MachineIcon worker={item.worker} />
										<span className="min-w-0 flex-1 truncate" title={item.unit || item.process}>
											{item.process}
										</span>
										<Badge variant="secondary" className="font-mono">
											:{item.port}
										</Badge>
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</div>
				{kind === 'public' && (
					<div className="min-w-0 flex-1">
						<Input
							id="expose-hostname"
							aria-label="Public hostname"
							required
							placeholder="app.example.com"
							autoCapitalize="none"
							spellCheck={false}
							value={hostname}
							disabled={pending}
							onChange={event => setHostname(String.toLowerCase(event.target.value))}
						/>
					</div>
				)}
				<Button
					type="submit"
					size="icon"
					aria-label="Expose port"
					disabled={
						pending ||
						selectedItem === undefined ||
						(kind === 'tailnet' && tailnetHost === '') ||
						(kind === 'public' && hostname === '')
					}
				>
					{Boolean.match(pending, {onFalse: () => <Plus />, onTrue: () => <Spinner />})}
				</Button>
			</div>
			{selectedId !== '' && selectedItem === undefined && !AsyncResult.isSuccess(result) && (
				<p className="text-warning text-xs" role="status">
					The selected listener is no longer available. Pick another port.
				</p>
			)}
			{AsyncResult.isSuccess(result) && (
				<a className="text-primary text-xs wrap-anywhere" href={result.value} target="_blank" rel="noreferrer">
					{result.value}
				</a>
			)}
			<ResultError result={result} />
		</form>
	)
}

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
	if (Option.isSome(String.match(/running|online|listening/u)(state))) return 'live'
	return 'quiet'
}

function ExposureLink(props: {item: InventoryItem}) {
	const [result, hide] = useAtom(
		hideAtom(
			Boolean.match(String.startsWith('remote:')(props.item.id), {onFalse: () => '', onTrue: () => props.item.worker})
		)(props.item.name)
	)
	return (
		<div className="min-w-0">
			<div className="flex items-center gap-1">
				<Badge
					variant="outline"
					className="max-w-full font-mono"
					render={
						<a
							href={props.item.url}
							aria-label={props.item.url}
							target="_blank"
							rel="noreferrer"
							title={props.item.url}
						/>
					}
				>
					{Boolean.match(props.item.publicAccess === true, {
						onFalse: () => <Network className="size-3 shrink-0" aria-label="Tailnet" />,
						onTrue: () => <Globe className="size-3 shrink-0" aria-label="Public" />
					})}
					<span className="truncate">
						{Boolean.match(props.item.publicAccess === true, {
							onFalse: () => `:${props.item.port}`,
							onTrue: () => String.replace(/^https:\/\//u, '')(props.item.url)
						})}
					</span>
				</Badge>
				{props.item.owned === true && (
					<Button
						size="icon-sm"
						variant="ghost"
						disabled={AsyncResult.isWaiting(result)}
						aria-label={`Remove ${props.item.name} exposure`}
						onClick={() => hide()}
					>
						<X />
					</Button>
				)}
			</div>
			<ResultError result={result} />
		</div>
	)
}

function WorkloadRow(props: {row: ReturnType<typeof workloads>[number]; showMachine: boolean; expanded?: boolean}) {
	const state = status(props.row.item)
	const processes = props.row.item.processes ?? []
	return (
		<div className="deploy-process-grid min-w-0 gap-y-1" data-show-machine={props.showMachine}>
			<ApplicationIcon
				name={workloadName(props.row.item)}
				process={processTree(processes)[0]?.name}
				container={props.row.item.kind === 'container'}
			/>
			<span className="min-w-0 truncate text-sm font-medium" title={props.row.item.name}>
				{workloadName(props.row.item)}
			</span>
			<ProcessUsage {...processUsage(processes)} />
			{props.showMachine && <MachineIcon worker={props.row.item.worker} />}
			<span title={state} aria-label={state} role="img" className="flex items-center justify-center">
				<StatusDot status={dot(props.row.item, state)} />
			</span>
			<ChevronRight
				className={`text-muted-foreground size-3 ${Boolean.match(props.expanded === undefined, {onFalse: () => Boolean.match(props.expanded === true, {onFalse: () => '', onTrue: () => 'rotate-90'}), onTrue: () => 'invisible'})}`}
			/>
			<div className="col-start-2 col-end-5 flex min-w-0 flex-wrap items-center gap-1 empty:hidden">
				{Array.map(
					Array.dedupe(
						Array.map(
							Array.filter(
								props.row.listeners,
								listener =>
									listener.address !== 'container' &&
									!Array.some(props.row.exposures, exposure => exposure.port === listener.port)
							),
							listener => listener.port
						)
					),
					port => (
						<Badge key={port} variant="secondary" className="font-mono">
							:{port}
						</Badge>
					)
				)}
				{Array.map(props.row.exposures, exposure => (
					<ExposureLink key={exposure.id} item={exposure} />
				))}
			</div>
			{(state === 'stale' ||
				state === 'unhealthy' ||
				String.includes('failed')(state) ||
				String.includes('exited')(state)) && (
				<p
					className={`col-start-2 col-end-5 text-xs wrap-anywhere ${Boolean.match(dot(props.row.item, state) === 'error', {onFalse: () => Boolean.match(dot(props.row.item, state) === 'warning', {onFalse: () => 'text-muted-foreground', onTrue: () => 'text-warning'}), onTrue: () => 'text-destructive'})}`}
				>
					{props.row.item.detail}
				</p>
			)}
		</div>
	)
}

function InventoryRow(props: {row: ReturnType<typeof workloads>[number]; showMachine: boolean; processMatch: boolean}) {
	const [open, setOpen] = useState(false)
	const processes = processTree(props.row.item.processes ?? [])
	if (processes.length < 2 && !props.processMatch) {
		return (
			<div role="listitem" className="border-b py-2.5">
				<WorkloadRow row={props.row} showMachine={props.showMachine} />
			</div>
		)
	}
	return (
		<details
			role="listitem"
			className="border-b"
			open={open || props.processMatch}
			onToggle={event => setOpen(event.currentTarget.open)}
		>
			<summary className="cursor-pointer list-none py-2.5 [&::-webkit-details-marker]:hidden">
				<WorkloadRow row={props.row} expanded={open || props.processMatch} showMachine={props.showMachine} />
			</summary>
			{(open || props.processMatch) && <Processes rows={processes} showMachine={props.showMachine} />}
		</details>
	)
}

function Services() {
	const result = useAtomSuspense(inventoryAtom)
	const [query, setQuery] = useState('')
	const search = useSearch({from: '/(home)'})
	const items = Array.filter(
		result.value.items,
		item => search.machine === undefined || search.machine === 'all' || item.worker === search.machine
	)
	const rows = Array.filter(workloads(items), row =>
		String.includes(String.toLowerCase(query))(
			String.toLowerCase(
				`${row.item.worker} ${row.item.name} ${Array.join(
					Array.map(row.item.processes ?? [], process => process.name),
					' '
				)} ${Array.join(
					Array.map(row.listeners, listener => `${listener.port}`),
					' '
				)} ${Array.join(
					Array.map(row.exposures, exposure => exposure.url),
					' '
				)}`
			)
		)
	)
	const apps = Array.filter(rows, row => row.item.scheduled !== true)
	const jobs = Array.filter(rows, row => row.item.scheduled === true)
	return (
		<div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 self-center">
			<Expose key={search.machine ?? 'all'} items={items} choices={availablePorts(items)} />
			<div className="flex items-center gap-3">
				<Input
					aria-label="Find a service or port"
					placeholder="Filter apps, ports, processes…"
					value={query}
					onChange={event => setQuery(event.target.value)}
				/>
				<span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">{apps.length} apps</span>
			</div>
			{Array.map(
				Array.filter(
					result.value.sources,
					source => source.error !== '' && !Array.contains(result.value.workers ?? [], source.name)
				),
				source => (
					<p key={source.name} className="text-destructive text-xs wrap-anywhere" role="alert" title={source.error}>
						{source.name}: {source.error}
					</p>
				)
			)}
			<div className="pb-safe min-h-0 flex-1 overflow-y-auto pr-3">
				{Array.map(
					[
						{label: 'Apps', rows: apps},
						// What a timer starts, such as an updater, after the apps it serves.
						{label: 'Scheduled', rows: jobs}
					],
					group =>
						!Array.isArrayEmpty(group.rows) && (
							<section key={group.label} aria-label={group.label} className="not-first:mt-6">
								{group.label === 'Scheduled' && <h2 className="text-muted-foreground mb-1 text-xs">Scheduled</h2>}
								<div role="list">
									{Array.map(group.rows, row => (
										<InventoryRow
											key={`${row.item.id}:${query !== ''}`}
											row={row}
											showMachine={search.machine === undefined || search.machine === 'all'}
											processMatch={
												query !== '' &&
												!String.includes(String.toLowerCase(query))(
													String.toLowerCase(
														`${row.item.worker} ${row.item.name} ${Array.join(
															Array.map(row.listeners, listener => `${listener.port}`),
															' '
														)} ${Array.join(
															Array.map(row.exposures, exposure => exposure.url),
															' '
														)}`
													)
												)
											}
										/>
									))}
								</div>
							</section>
						)
				)}
				{Array.isArrayEmpty(rows) && <p className="text-muted-foreground text-sm">No matching apps.</p>}
			</div>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Services, errorComponent: PageError})
