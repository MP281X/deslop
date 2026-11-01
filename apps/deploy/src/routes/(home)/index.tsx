import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

import {createFileRoute, useSearch} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Box, Cog, Globe, Network, Plus, Radio, X} from 'lucide-react'
import {useState} from 'react'

import {ItemList} from '@deslop/components-web/item-list'
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
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'

import {MachineIcon} from '#lib/components.tsx'
import {exposeAtom, hideAtom, inventoryAtom} from '#lib/utils.ts'
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
						<ComboboxContent>
							<ComboboxEmpty>No matching app listeners.</ComboboxEmpty>
							<ComboboxList>
								{(item: InventoryItem) => (
									<ComboboxItem key={item.id} value={item}>
										<MachineIcon worker={item.worker} />
										<span className="min-w-0 flex-1 truncate">{item.process}</span>
										<Badge variant="secondary" className="font-mono">
											:{item.port}
										</Badge>
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</div>
				<div className="min-w-0 flex-1">
					<Input
						id="expose-hostname"
						aria-label={Boolean.match(kind === 'public', {
							onFalse: () => 'Tailnet hostname',
							onTrue: () => 'Public hostname'
						})}
						required={kind === 'public'}
						readOnly={kind === 'tailnet'}
						placeholder={Boolean.match(kind === 'public', {
							onFalse: () => 'Automatic HTTPS',
							onTrue: () => 'app.example.com'
						})}
						autoCapitalize="none"
						spellCheck={false}
						value={Boolean.match(kind === 'public', {onFalse: () => tailnetHost, onTrue: () => hostname})}
						disabled={pending}
						onChange={event => setHostname(String.toLowerCase(event.target.value))}
					/>
				</div>
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

function InventoryRow(props: {row: ReturnType<typeof workloads>[number]}) {
	const state = status(props.row.item)
	return (
		<Item role="listitem" size="sm" className="min-h-16 flex-nowrap gap-3 px-1">
			<ItemMedia className="group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
				<span title={props.row.item.kind} aria-label={props.row.item.kind} role="img">
					{pipe(
						Match.value(props.row.item.kind),
						Match.when('container', () => <Box className="size-4" />),
						Match.when('service', () => <Cog className="size-4" />),
						Match.when('exposure', () => <Globe className="size-4" />),
						Match.orElse(() => <Radio className="size-4" />)
					)}
				</span>
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="line-clamp-none block w-full truncate" title={workloadName(props.row.item)}>
					{workloadName(props.row.item)}
				</ItemTitle>
				<div className="flex min-w-0 flex-wrap items-center gap-1">
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
					<ItemDescription className="line-clamp-none wrap-anywhere">{props.row.item.detail}</ItemDescription>
				)}
			</ItemContent>
			<ItemActions className="gap-3">
				<MachineIcon worker={props.row.item.worker} />
				<span title={state} aria-label={state} role="img">
					<StatusDot status={dot(props.row.item, state)} />
				</span>
			</ItemActions>
		</Item>
	)
}

function Services() {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const [query, setQuery] = useState('')
	const [view, setView] = useState('apps')
	const search = useSearch({from: '/(home)'})
	if (AsyncResult.isFailure(result)) return <ResultError result={result} />
	const items = Array.filter(
		result.value.items,
		item => search.machine === undefined || search.machine === 'all' || item.worker === search.machine
	)
	const rows = Array.filter(workloads(items, view === 'all'), row =>
		String.includes(String.toLowerCase(query))(
			String.toLowerCase(
				`${row.item.worker} ${row.item.name} ${row.item.detail} ${Array.join(
					Array.map(row.listeners, listener => `${listener.port}`),
					' '
				)} ${Array.join(
					Array.map(row.exposures, exposure => exposure.url),
					' '
				)}`
			)
		)
	)
	return (
		<div className="flex w-full max-w-3xl flex-col gap-4 self-center">
			<Expose key={search.machine ?? 'all'} items={items} choices={availablePorts(items)} />
			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<ToggleGroup
						aria-label="Inventory view"
						value={[view]}
						onValueChange={values => setView(values[0] ?? 'apps')}
					>
						<ToggleGroupItem value="apps">Apps</ToggleGroupItem>
						<ToggleGroupItem value="all">All services</ToggleGroupItem>
					</ToggleGroup>
					<span className="text-muted-foreground font-mono text-xs">{rows.length}</span>
				</div>
				<Input
					aria-label="Find a service or port"
					placeholder="Filter by app, port or worker…"
					value={query}
					onChange={event => setQuery(event.target.value)}
				/>
			</div>
			{Array.map(
				Array.filter(result.value.sources, source => source.error !== ''),
				source => (
					<p key={source.name} className="text-warning text-xs wrap-anywhere" role="status">
						{source.name}: {source.error}
					</p>
				)
			)}
			<ItemList label="Services and ports">
				{Array.map(rows, row => (
					<InventoryRow key={row.item.id} row={row} />
				))}
			</ItemList>
			{Array.isArrayEmpty(rows) && (
				<p className="text-muted-foreground text-sm">
					No matching apps. All services includes background services and unmatched listeners.
				</p>
			)}
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Services})
