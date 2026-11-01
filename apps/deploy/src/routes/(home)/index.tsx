import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause, Number, Option, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {ArrowUpRight, Plus, X} from 'lucide-react'
import {Suspense, useState} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Button} from '@deslop/components-web/ui/button'
import {Input} from '@deslop/components-web/ui/input'
import {Item, ItemActions, ItemContent, ItemDescription, ItemTitle} from '@deslop/components-web/ui/item'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {exposeAtom, hideAtom, inventoryAtom} from '#lib/utils.ts'
import icon from '#routes/icon-dark.svg'

function Expose(props: {port: string; target: string}) {
	const [result, expose] = useAtom(exposeAtom)
	const [kind, setKind] = useState<'tailnet' | 'public'>('tailnet')
	return (
		<form
			className="bg-muted flex flex-col gap-3 rounded-lg p-3"
			onSubmit={event => {
				event.preventDefault()
				const fields = new FormData(event.currentTarget)
				expose({
					hostname: `${fields.get('hostname') ?? ''}`,
					kind,
					name: `${fields.get('name') ?? ''}`,
					port: Option.getOrElse(Number.parse(`${fields.get('port') ?? ''}`), () => 0),
					publicAccess: fields.get('public') === 'on',
					target: props.target
				})
			}}
		>
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">
					Expose a port{' '}
					{props.target !== '' && <span className="text-muted-foreground font-normal">on {props.target}</span>}
				</h2>
				<ToggleGroup
					value={[kind]}
					onValueChange={values => {
						if (values[0] === 'public' || values[0] === 'tailnet') setKind(values[0])
					}}
				>
					<ToggleGroupItem value="tailnet">Tailnet</ToggleGroupItem>
					<ToggleGroupItem value="public">Public</ToggleGroupItem>
				</ToggleGroup>
			</div>
			<div className="flex flex-wrap items-end gap-2">
				<label htmlFor="expose-name" className="flex min-w-32 flex-1 flex-col gap-1 text-xs">
					Name
					<Input id="expose-name" required name="name" placeholder="portfolio-preview" maxLength={100} />
				</label>
				<label htmlFor="expose-port" className="flex w-24 flex-col gap-1 text-xs">
					Local port
					<Input
						id="expose-port"
						required
						type="number"
						name="port"
						min={1024}
						max={65_535}
						placeholder="5173"
						defaultValue={props.port}
					/>
				</label>
				<label htmlFor="expose-hostname" className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
					{Boolean.match(kind === 'tailnet', {onFalse: () => 'Public hostname', onTrue: () => 'Tailnet hostname'})}
					<Input
						required
						id="expose-hostname"
						name="hostname"
						placeholder={Boolean.match(kind === 'tailnet', {
							onFalse: () => 'preview.example.com',
							onTrue: () => 'dev.tailnet-8c4c.ts.net'
						})}
					/>
				</label>
				<Button size="icon" aria-label="Expose port" type="submit" disabled={AsyncResult.isWaiting(result)}>
					<Plus />
				</Button>
			</div>
			{kind === 'public' && (
				<label className="flex items-center gap-2 text-xs">
					<input type="checkbox" name="public" required />I intend to make this backend publicly reachable.
				</label>
			)}
			<p className="text-muted-foreground text-xs">
				Changes exposure only. Does not start the backend or add authentication.
			</p>
			{AsyncResult.isSuccess(result) && (
				<a className="text-primary text-xs" href={result.value} target="_blank" rel="noreferrer">
					{result.value}
				</a>
			)}
			{Option.match(AsyncResult.error(result), {
				onNone: () => null,
				onSome: error => (
					<p className="text-destructive text-xs" role="alert">
						{error.message}
					</p>
				)
			})}
		</form>
	)
}

function Services() {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const [query, setQuery] = useState('')
	const [kind, setKind] = useState('all')
	const [selectedId, setSelectedId] = useState('')
	const [removed, hide] = useAtom(hideAtom)
	if (AsyncResult.isFailure(result)) {
		if (Option.exists(Cause.findErrorOption(result.cause), error => error._tag === 'AuthError')) {
			return <SignIn href={signInUrl(location.href)} />
		}
		return <Error error={Cause.squash(result.cause)} reset={() => location.reload()} />
	}
	const rows = Array.filter(
		result.value.items,
		item =>
			(kind === 'all' || item.kind === kind) &&
			String.includes(String.toLowerCase(query))(String.toLowerCase(`${item.name} ${item.detail}`))
	)
	const selected = Array.findFirst(result.value.items, item => item.id === selectedId)
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<Input
					aria-label="Find a service or port"
					placeholder="Find a service or port…"
					value={query}
					onChange={event => setQuery(event.target.value)}
					className="min-w-40 flex-1"
				/>
				<ToggleGroup value={[kind]} onValueChange={values => setKind(values[0] ?? 'all')}>
					{Array.map(['all', 'service', 'container', 'port', 'exposure', 'peer'], value => (
						<ToggleGroupItem key={value} value={value}>
							{value}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{Array.map(
				Array.filter(result.value.sources, source => source.error !== ''),
				source => (
					<p key={source.name} className="text-warning text-xs" role="status">
						{source.name}: {source.error}
					</p>
				)
			)}
			<div role="list" aria-label="Services and ports">
				{Array.map(rows, item => (
					<Item
						key={item.id}
						size="sm"
						variant={Boolean.match(selectedId === item.id, {
							onFalse: () => 'default' as const,
							onTrue: () => 'muted' as const
						})}
					>
						<ItemContent>
							<button
								type="button"
								className="text-left"
								onClick={() =>
									setSelectedId(Boolean.match(selectedId === item.id, {onFalse: () => item.id, onTrue: () => ''}))
								}
							>
								<ItemTitle>{item.name}</ItemTitle>
								<ItemDescription className="line-clamp-1">
									{item.kind} · {item.detail}
								</ItemDescription>
							</button>
						</ItemContent>
						<ItemActions>
							<span className="text-muted-foreground text-xs">{item.state}</span>
							{item.url !== '' && (
								<a href={item.url} aria-label={`Open ${item.name}`} target="_blank" rel="noreferrer">
									<ArrowUpRight className="size-4" />
								</a>
							)}
							{String.includes(':exposure:')(item.id) && (
								<Button
									size="icon-sm"
									variant="ghost"
									aria-label={`Remove ${item.name} exposure`}
									onClick={() =>
										hide({
											name: item.name,
											target: Boolean.match(String.startsWith('remote:')(item.id), {
												onFalse: () => '',
												onTrue: () => item.worker
											})
										})
									}
								>
									<X />
								</Button>
							)}
						</ItemActions>
					</Item>
				))}
			</div>
			{Array.isArrayEmpty(rows) && <p className="text-muted-foreground text-sm">No matching services or ports.</p>}
			{Option.match(selected, {
				onNone: () => null,
				onSome: item => (
					<section className="bg-muted flex flex-col gap-1 rounded-lg p-3">
						<h2 className="text-sm font-semibold">{item.name}</h2>
						<p className="text-muted-foreground text-xs">
							{item.worker} · {item.kind} · {item.state}
						</p>
						<pre className="font-mono text-xs wrap-anywhere whitespace-pre-wrap">{item.detail}</pre>
					</section>
				)
			})}
			{Option.match(AsyncResult.error(removed), {
				onNone: () => null,
				onSome: error => (
					<p className="text-destructive text-xs" role="alert">
						{error.message}
					</p>
				)
			})}
			<Expose
				key={selectedId}
				target={Option.match(selected, {
					onNone: () => '',
					onSome: item =>
						Boolean.match(String.startsWith('remote:')(item.id), {onFalse: () => '', onTrue: () => item.worker})
				})}
				port={Option.getOrElse(
					Option.flatMap(selected, item => {
						if (item.kind !== 'port') return Option.none<string>()
						return Array.last(String.split(item.name, ':'))
					}),
					() => ''
				)}
			/>
		</div>
	)
}

function Home() {
	return (
		<>
			<AppBar name="deploy" icon={icon} />
			<main className="pb-safe mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 py-6">
				<Suspense fallback={<ItemListSkeleton label="Services" rows={6} />}>
					<Services />
				</Suspense>
			</main>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
