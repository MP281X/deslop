import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Option, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Box, Cog, Globe, Network, Plus, Radio, X} from 'lucide-react'
import {Suspense, useState} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemList, ItemListSkeleton} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList
} from '@deslop/components-web/ui/combobox'
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {exposeAtom, hideAtom, inventoryAtom} from '#lib/utils.ts'
import {ResourceHistory} from '#routes/(home)/-metrics.tsx'
import icon from '#routes/icon-dark.svg'
import {portLabel, ports, workloads} from '#services/inventory/lib/utils.ts'
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
	const tailnetUrl = `https://${tailnetHost}:${selectedItem?.port}`
	const existing = Array.findFirst(
		props.items,
		item =>
			item.kind === 'exposure' &&
			item.worker === selectedItem?.worker &&
			(item.url === tailnetUrl || String.startsWith(`${tailnetUrl}/`)(item.url))
	)
	return (
		<form
			aria-label="Expose a port"
			className="flex flex-col gap-3 border-b pb-4"
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
			<div className="flex flex-wrap items-center justify-between gap-2">
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
			<div className="flex items-end gap-2">
				<Field className="min-w-0 flex-1">
					<FieldLabel htmlFor="expose-port">App</FieldLabel>
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
										{portLabel(item)}
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</Field>
				<Button
					type="submit"
					size="icon"
					aria-label="Expose port"
					disabled={
						pending ||
						selectedItem === undefined ||
						(kind === 'tailnet' && (tailnetHost === '' || Option.isSome(existing)))
					}
				>
					{Boolean.match(pending, {onFalse: () => <Plus />, onTrue: () => <Spinner />})}
				</Button>
			</div>
			{kind === 'public' && (
				<Field>
					<FieldLabel htmlFor="expose-hostname">Public hostname</FieldLabel>
					<Input
						id="expose-hostname"
						required
						placeholder="preview.example.com"
						autoCapitalize="none"
						spellCheck={false}
						value={hostname}
						disabled={pending}
						onChange={event => setHostname(String.toLowerCase(event.target.value))}
					/>
				</Field>
			)}
			{kind === 'tailnet' && selectedItem !== undefined && (
				<p className="text-muted-foreground text-xs wrap-anywhere">
					{Boolean.match(tailnetHost === '', {
						onFalse: () =>
							Option.match(existing, {
								onNone: () => <span className="font-mono">{tailnetUrl}</span>,
								onSome: item => (
									<a href={item.url} target="_blank" rel="noreferrer">
										Already exposed · <span className="font-mono">{item.url}</span>
									</a>
								)
							}),
						onTrue: () => 'Tailscale is unavailable on this worker.'
					})}
				</p>
			)}
			{selectedId !== '' && selectedItem === undefined && (
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

function title(item: InventoryItem) {
	if (item.kind === 'port') return `${item.process || item.protocol} :${item.port}`
	if (item.kind === 'container' && String.startsWith('deslop-')(item.name)) {
		return String.replace(/-[0-9]+$/u, '')(String.slice(7)(item.name))
	}
	if (String.startsWith('preview-')(item.name)) {
		return Option.match(String.match(/@deslop\/([a-z0-9-]+)/u)(item.detail), {
			onNone: () => item.name,
			onSome: app => `${app[1]} preview`
		})
	}
	return String.replace(/\.service$/u, '')(item.name)
}

function ExposureLink(props: {item: InventoryItem}) {
	const [result, hide] = useAtom(
		hideAtom(
			Boolean.match(String.startsWith('remote:')(props.item.id), {onFalse: () => '', onTrue: () => props.item.worker})
		)(props.item.name)
	)
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-1">
				<a
					className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs wrap-anywhere"
					href={props.item.url}
					target="_blank"
					rel="noreferrer"
				>
					{Boolean.match(props.item.publicAccess === true, {
						onFalse: () => <Network className="size-3 shrink-0" aria-label="Tailnet" />,
						onTrue: () => <Globe className="size-3 shrink-0" aria-label="Public" />
					})}
					<span className="min-w-0 font-mono wrap-anywhere">{String.replace(/^https:\/\//u, '')(props.item.url)}</span>
				</a>
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
		<Item role="listitem" size="sm">
			<ItemMedia>
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
				<ItemTitle className="wrap-anywhere">
					{title(props.row.item)}{' '}
					<span className="text-muted-foreground font-mono text-xs font-normal">{props.row.item.worker}</span>
				</ItemTitle>
				{Array.isArrayNonEmpty(props.row.listeners) && (
					<ItemDescription className="line-clamp-none font-mono text-xs wrap-anywhere">
						{Array.join(
							Array.dedupe(
								Array.map(
									props.row.listeners,
									listener =>
										`${listener.protocol} :${listener.port}${Boolean.match(listener.address === 'container', {onFalse: () => '', onTrue: () => ' (route)'})}`
								)
							),
							' · '
						)}
					</ItemDescription>
				)}
				{(state === 'stale' ||
					state === 'unhealthy' ||
					String.includes('failed')(state) ||
					String.includes('exited')(state)) && (
					<ItemDescription className="line-clamp-none wrap-anywhere">{props.row.item.detail}</ItemDescription>
				)}
				{Array.map(props.row.exposures, exposure => (
					<ExposureLink key={exposure.id} item={exposure} />
				))}
			</ItemContent>
			<ItemActions className="max-w-full">
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
	const [machine, setMachine] = useState('')
	if (AsyncResult.isFailure(result)) {
		if (Option.exists(Cause.findErrorOption(result.cause), error => error._tag === 'AuthError')) {
			return <SignIn href={signInUrl(location.href)} />
		}
		return <Error error={Cause.squash(result.cause)} reset={() => location.reload()} />
	}
	const items = Array.filter(result.value.items, item => machine === '' || item.worker === machine)
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
	const choices = ports(
		Array.flatMap(workloads(items, false), row =>
			Array.map(
				Array.filter(
					row.listeners,
					listener => !Array.some(row.listeners, candidate => candidate.ui === true) || listener.ui === true
				),
				listener => ({...listener, process: title(row.item)})
			)
		)
	)
	return (
		<div className="flex flex-col gap-4">
			<ToggleGroup aria-label="Machine" value={[machine]} onValueChange={values => setMachine(values[0] ?? '')}>
				<ToggleGroupItem value="">All machines</ToggleGroupItem>
				{Array.map(result.value.workers ?? Array.dedupe(Array.map(result.value.items, item => item.worker)), name => (
					<ToggleGroupItem key={name} value={name}>
						{name}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<Expose key={machine} items={items} choices={choices} />
			<ResourceHistory machine={machine} />
			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<ToggleGroup
						aria-label="Inventory view"
						value={[view]}
						onValueChange={values => setView(values[0] ?? 'apps')}
					>
						<ToggleGroupItem value="apps">Apps</ToggleGroupItem>
						<ToggleGroupItem value="all">System</ToggleGroupItem>
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
					No matching apps. System includes background services and unmatched listeners.
				</p>
			)}
		</div>
	)
}

function Home() {
	return (
		<>
			<AppBar name="deploy" icon={icon} />
			<main className="pb-safe mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 py-6">
				<Suspense
					fallback={
						<div className="flex flex-col gap-3">
							<h1 className="text-sm font-semibold">Expose a port</h1>
							<Skeleton className="h-7 w-full" />
							<ItemListSkeleton label="Services" rows={6} />
						</div>
					}
				>
					<Services />
				</Suspense>
			</main>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
