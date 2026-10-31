import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Option, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {MachineState} from '@typeonce/effect-machine-react'
import {AsyncResult} from 'effect/reactivity'
import {Check, Copy, Ellipsis, Plus} from 'lucide-react'
import {useState} from 'react'

import {Error, Loading} from '@deslop/components-web/fallbacks'
import {Button, buttonVariants} from '@deslop/components-web/ui/button'
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle} from '@deslop/components-web/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {Input} from '@deslop/components-web/ui/input'
import {cn} from '@deslop/components-web/utils'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {
	ENDPOINT,
	addAtom,
	connectUrl,
	copyEndpointAtom,
	disconnectAtom,
	hideAtom,
	lastCallAtom,
	removeAtom,
	serversAtom
} from '#lib/utils.ts'
import type {ConnectionInfo} from '#services/connections/schema.ts'

// The server's favicon through Google's favicon service, as Stash shows a source's, never a letter tile.
function Favicon(props: {url: string}) {
	return (
		<img
			src={`https://www.google.com/s2/favicons?domain=${new URL(props.url).hostname}&sz=64`}
			alt=""
			className="size-4 shrink-0 rounded-sm"
		/>
	)
}

// Live in the primary, expired red, not connected hollow; like a port light it dims per tool call, a new key replaying it.
function Status(props: {server: ConnectionInfo}) {
	const call = useAtomValue(lastCallAtom(props.server.id))
	return (
		<span
			className={cn(
				'flex shrink-0 items-center gap-1.5 text-xs',
				props.server.status === 'Not connected' && 'text-muted-foreground'
			)}
		>
			<span
				key={call}
				aria-hidden="true"
				className={cn(
					'size-1.5 rounded-full',
					call >= 0 && 'port-blink',
					props.server.status === 'Connected' && 'bg-primary',
					props.server.status === 'Expired' && 'bg-destructive',
					props.server.status === 'Not connected' && 'border-muted-foreground border'
				)}
			/>
			{props.server.status}
		</span>
	)
}

function ServerMenu(props: {busy: boolean; onRemove: () => void; server: ConnectionInfo}) {
	const [, disconnect] = useAtom(disconnectAtom(props.server.id))
	const [, hide] = useAtom(hideAtom(props.server.id))
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button variant="ghost" size="icon-sm" aria-label={`Manage ${props.server.name}`} disabled={props.busy} />
				}
			>
				<Ellipsis />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-36">
				{props.server.status === 'Connected' && (
					<DropdownMenuItem onClick={() => location.assign(connectUrl(props.server.id))}>Reconnect</DropdownMenuItem>
				)}
				{props.server.status === 'Connected' && (
					<DropdownMenuItem onClick={() => disconnect()}>Disconnect</DropdownMenuItem>
				)}
				{/* Agents see only the checked tools. */}
				{Array.isReadonlyArrayNonEmpty(props.server.tools) && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>Tools</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{Array.map(props.server.tools, tool => (
								<DropdownMenuCheckboxItem
									key={tool}
									checked={!Array.contains(props.server.hidden, tool)}
									onCheckedChange={visible => hide({hidden: !visible, tool})}
								>
									<span className="font-mono">{tool}</span>
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}
				<DropdownMenuItem variant="destructive" onClick={props.onRemove}>
					Remove
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// One hairline row: favicon, name and host, then its state and the one action it needs.
function ServerRow(props: {server: ConnectionInfo}) {
	const [disconnecting] = useAtom(disconnectAtom(props.server.id))
	const [removing, remove] = useAtom(removeAtom(props.server.id))
	const [hiding] = useAtom(hideAtom(props.server.id))
	const [confirm, setConfirm] = useState(false)
	const busy = AsyncResult.isWaiting(disconnecting) || AsyncResult.isWaiting(removing) || AsyncResult.isWaiting(hiding)
	const shown = Array.filter(props.server.tools, tool => !Array.contains(props.server.hidden, tool))
	const failure = Option.orElse(AsyncResult.error(disconnecting), () => AsyncResult.error(hiding))
	return (
		<li className="border-border flex flex-col gap-1 border-b py-2.5">
			<div className="flex items-center gap-3">
				<Favicon url={props.server.url} />
				<span className="max-w-48 min-w-0 truncate text-sm font-medium">{props.server.name}</span>
				<span className="text-muted-foreground min-w-0 grow truncate font-mono text-xs">
					{new URL(props.server.url).hostname}
				</span>
				<Status server={props.server} />
				{pipe(
					Match.value(props.server.status),
					Match.when('Connected', () =>
						Array.match(props.server.tools, {
							onEmpty: () => null,
							onNonEmpty: tools => (
								<span className="text-muted-foreground w-12 text-right font-mono text-xs">
									{shown.length}/{tools.length}
								</span>
							)
						})
					),
					Match.orElse(status => (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							onClick={() => location.assign(connectUrl(props.server.id))}
						>
							{Boolean.match(status === 'Expired', {onFalse: () => 'Connect', onTrue: () => 'Reconnect'})}
						</Button>
					))
				)}
				<ServerMenu busy={busy} onRemove={() => setConfirm(true)} server={props.server} />
			</div>
			{Option.match(Option.fromUndefinedOr(props.server.error), {
				onNone: () => null,
				onSome: error => <p className="text-destructive pl-7 text-xs break-words">{error}</p>
			})}
			{Option.match(failure, {
				onNone: () => null,
				onSome: error => (
					<p className="text-destructive pl-7 text-xs" role="alert">
						{error.message}
					</p>
				)
			})}
			<Dialog open={confirm} onOpenChange={setConfirm}>
				<DialogContent>
					<DialogTitle>Remove {props.server.name}?</DialogTitle>
					<DialogDescription>
						Its tools will no longer be available through the gateway. This does not revoke the provider’s grant.
					</DialogDescription>
					{Option.match(AsyncResult.error(removing), {
						onNone: () => null,
						onSome: error => (
							<p className="text-destructive text-xs" role="alert">
								{error.message}
							</p>
						)
					})}
					<div className="flex justify-end gap-2">
						<DialogClose render={<Button variant="ghost" disabled={busy} />}>Cancel</DialogClose>
						<Button variant="destructive" disabled={busy} onClick={() => remove()}>
							Remove server
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</li>
	)
}

function AddForm(props: {url: string; error: string; adding: boolean}) {
	const send = useAtomSet(addAtom.send)
	return (
		<form
			className="flex flex-col gap-2"
			onSubmit={event => {
				event.preventDefault()
				send({_tag: 'Submit'})
			}}
		>
			<label className="text-muted-foreground text-xs" htmlFor="mcp-url">
				MCP URL
			</label>
			<div className="flex gap-2">
				<Input
					id="mcp-url"
					type="url"
					autoComplete="url"
					placeholder="https://example.com/mcp"
					required
					autoFocus
					value={props.url}
					disabled={props.adding}
					onChange={event => send({_tag: 'Typed', url: event.target.value})}
					aria-invalid={props.error !== ''}
					aria-describedby="mcp-add-error"
					className="font-mono"
				/>
				<Button variant="ghost" type="button" disabled={props.adding} onClick={() => send({_tag: 'Cancel'})}>
					Cancel
				</Button>
				<Button type="submit" disabled={props.adding}>
					{Boolean.match(props.adding, {onFalse: () => 'Add server', onTrue: () => 'Adding…'})}
				</Button>
			</div>
			{props.error !== '' && (
				<p className="text-destructive text-xs" role="alert" id="mcp-add-error">
					{props.error}
				</p>
			)}
		</form>
	)
}

// The endpoint agents connect to, copied in one click.
function Endpoint() {
	const [copied, copy] = useAtom(copyEndpointAtom)
	return (
		<div className="flex flex-col gap-1">
			<Button
				variant="outline"
				onClick={() => copy()}
				disabled={AsyncResult.isWaiting(copied)}
				aria-label="Copy gateway endpoint"
				className="font-mono"
			>
				{ENDPOINT}
				{Boolean.match(AsyncResult.isSuccess(copied), {
					onFalse: () => <Copy className="text-muted-foreground" />,
					onTrue: () => <Check className="text-primary" />
				})}
			</Button>
			{Option.match(AsyncResult.error(copied), {
				onNone: () => null,
				onSome: error => (
					<p className="text-destructive text-xs" role="alert">
						{error.message}
					</p>
				)
			})}
		</div>
	)
}

function Directory(props: {servers: readonly ConnectionInfo[]}) {
	const send = useAtomSet(addAtom.send)
	return (
		<>
			<div className="flex items-start justify-between gap-3">
				<Endpoint />
				<MachineState machine={addAtom} path="Closed">
					{() => (
						<Button onClick={() => send({_tag: 'Open'})}>
							<Plus />
							Add server
						</Button>
					)}
				</MachineState>
			</div>
			<MachineState machine={addAtom} path="Editing">
				{state => <AddForm url={state.value.url} error={state.value.error} adding={false} />}
			</MachineState>
			<MachineState machine={addAtom} path="Adding">
				{state => <AddForm url={state.value.url} error="" adding />}
			</MachineState>
			<section className="flex flex-col" aria-label="MCP servers">
				<h2 className="text-muted-foreground border-border border-b pb-2 font-mono text-xs">
					{props.servers.length}{' '}
					{Boolean.match(props.servers.length === 1, {onFalse: () => 'servers', onTrue: () => 'server'})}
				</h2>
				{Array.match(props.servers, {
					onEmpty: () => (
						<p className="text-muted-foreground py-6 text-sm">
							No servers yet. Add one to share its tools with every agent.
						</p>
					),
					onNonEmpty: rows => (
						<ul className="flex flex-col">
							{Array.map(rows, server => (
								<ServerRow key={server.id} server={server} />
							))}
						</ul>
					)
				})}
			</section>
		</>
	)
}

// The servers need a Deslop sign-in by an admin; GitHub returns here once it is done.
function Servers() {
	return AsyncResult.match(useAtomValue(serversAtom), {
		onFailure: failure =>
			Option.match(Cause.findErrorOption(failure.cause), {
				onNone: () => <Error error={Cause.squash(failure.cause)} reset={() => location.reload()} />,
				onSome: error => {
					if (error._tag !== 'AuthError') return <Error error={error} reset={() => location.reload()} />
					if (error.error === 'access_denied') return <p className="text-muted-foreground text-sm">{error.message}</p>
					return (
						<a className={buttonVariants({size: 'lg'})} href={signInUrl(location.href)}>
							Sign in with GitHub
						</a>
					)
				}
			}),
		onInitial: () => <Loading />,
		onSuccess: servers => <Directory servers={servers.value} />
	})
}

function Home() {
	return (
		<main className="flex flex-1 justify-center overflow-y-auto px-4 py-8 md:py-16">
			<div className="flex w-full max-w-3xl flex-col gap-5">
				<div className="flex flex-col gap-1">
					<h1 className="text-xl font-semibold tracking-tight">Servers</h1>
					<p className="text-muted-foreground text-sm">Tools your agents reach through one endpoint.</p>
				</div>
				<Servers />
			</div>
		</main>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
