import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause, Option, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {ArrowUpRight, Plus, X} from 'lucide-react'
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
import icon from '#routes/icon-dark.svg'
import {important, portLabel, ports} from '#services/inventory/lib/utils.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'

function Expose(props: {items: readonly InventoryItem[]}) {
	const [result, expose] = useAtom(exposeAtom)
	const [kind, setKind] = useState<'tailnet' | 'public'>('tailnet')
	const [selectedId, setSelectedId] = useState('')
	const [hostname, setHostname] = useState('')
	const choices = ports(props.items)
	const selectedItem = Option.getOrUndefined(Array.findFirst(choices, item => item.id === selectedId))
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
					publicAccess: new FormData(event.currentTarget).get('public') === 'on',
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
					<FieldLabel htmlFor="expose-port">HTTP app port</FieldLabel>
					<Combobox
						items={choices}
						value={selectedItem ?? null}
						itemToStringLabel={portLabel}
						isItemEqualToValue={(a, b) => a.id === b.id}
						onValueChange={item => setSelectedId(item?.id ?? '')}
						disabled={pending}
					>
						<ComboboxInput
							id="expose-port"
							aria-label="Listening port"
							placeholder="Find a port or process…"
							className="w-full"
							showClear
						/>
						<ComboboxContent>
							<ComboboxEmpty>No matching TCP listeners.</ComboboxEmpty>
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
				<>
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
					<label className="flex items-center gap-2 text-xs">
						<input
							key={`${selectedId}:${hostname}`}
							type="checkbox"
							name="public"
							required
							disabled={pending}
							className="accent-primary"
						/>
						Allow public internet access. Backend authentication is unchanged.
					</label>
				</>
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
	if (Option.isSome(String.match(/failed|unhealthy/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission') return 'warning'
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

function InventoryRow(props: {item: InventoryItem; multipleWorkers: boolean}) {
	const [result, hide] = useAtom(
		hideAtom(
			Boolean.match(String.startsWith('remote:')(props.item.id), {onFalse: () => '', onTrue: () => props.item.worker})
		)(props.item.name)
	)
	const item = props.item
	const state = status(item)
	return (
		<Item role="listitem" size="sm">
			<ItemMedia>
				<StatusDot status={dot(item, state)} />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="wrap-anywhere">{title(item)}</ItemTitle>
				<ItemDescription className="line-clamp-none wrap-anywhere">
					{props.multipleWorkers && `${item.worker} · `}
					{item.kind} ·{' '}
					{Boolean.match(String.startsWith('preview-')(item.name), {
						onFalse: () =>
							Boolean.match(item.kind === 'port', {
								onFalse: () => item.detail,
								onTrue: () => `${item.protocol} · ${item.address}`
							}),
						onTrue: () => 'App preview'
					})}
				</ItemDescription>
				{item.url !== '' && (
					<a
						className="text-muted-foreground font-mono text-xs wrap-anywhere"
						href={item.url}
						target="_blank"
						rel="noreferrer"
					>
						{item.url}
					</a>
				)}
				<ResultError result={result} />
			</ItemContent>
			<ItemActions className="max-w-full">
				<span className="text-muted-foreground text-xs">{state}</span>
				{item.url !== '' && (
					<a href={item.url} aria-label={`Open ${item.name}`} target="_blank" rel="noreferrer">
						<ArrowUpRight className="size-4" />
					</a>
				)}
				{item.owned === true && (
					<Button
						size="icon-sm"
						variant="ghost"
						disabled={AsyncResult.isWaiting(result)}
						aria-label={`Remove ${item.name} exposure`}
						onClick={() => hide()}
					>
						<X />
					</Button>
				)}
			</ItemActions>
		</Item>
	)
}

function Services() {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const [query, setQuery] = useState('')
	const [view, setView] = useState('apps')
	if (AsyncResult.isFailure(result)) {
		if (Option.exists(Cause.findErrorOption(result.cause), error => error._tag === 'AuthError')) {
			return <SignIn href={signInUrl(location.href)} />
		}
		return <Error error={Cause.squash(result.cause)} reset={() => location.reload()} />
	}
	const rows = Array.filter(result.value.items, item => {
		if (
			!String.includes(String.toLowerCase(query))(
				String.toLowerCase(`${item.worker} ${item.name} ${item.detail} ${item.state} ${item.url}`)
			)
		) {
			return false
		}
		if (view === 'apps') return important(item)
		if (view === 'ports') return item.kind === 'port'
		if (view === 'tailnet') return item.kind === 'peer' || (item.kind === 'exposure' && item.owned !== true)
		return true
	})
	const multipleWorkers = Array.dedupe(Array.map(result.value.items, item => item.worker)).length > 1
	return (
		<div className="flex flex-col gap-4">
			<Expose items={result.value.items} />
			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<ToggleGroup
						aria-label="Inventory view"
						value={[view]}
						onValueChange={values => setView(values[0] ?? 'apps')}
					>
						<ToggleGroupItem value="apps">Apps</ToggleGroupItem>
						<ToggleGroupItem value="ports">Ports</ToggleGroupItem>
						<ToggleGroupItem value="tailnet">Tailnet</ToggleGroupItem>
						<ToggleGroupItem value="all">Everything</ToggleGroupItem>
					</ToggleGroup>
					<span className="text-muted-foreground font-mono text-xs">
						{rows.length} / {result.value.items.length}
					</span>
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
				{Array.map(rows, item => (
					<InventoryRow key={item.id} item={item} multipleWorkers={multipleWorkers} />
				))}
			</ItemList>
			{Array.isArrayEmpty(rows) && (
				<p className="text-muted-foreground text-sm">
					No matching items. Everything includes system services and background listeners.
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
