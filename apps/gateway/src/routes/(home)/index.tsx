import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Option, Order, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {MachineState} from '@typeonce/effect-machine-react'
import {AsyncResult} from 'effect/reactivity'
import {Check, Copy, Ellipsis, Plus, Server} from 'lucide-react'
import {useState} from 'react'

import {Error, Loading, SignIn} from '@deslop/components-web/fallbacks'
import {ItemList} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
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
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput} from '@deslop/components-web/ui/input-group'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
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

// Live in the primary, expired red, not connected hollow; like a port light it dims per tool call, a new key replaying it.
function Status(props: {server: ConnectionInfo}) {
	const call = useAtomValue(lastCallAtom(props.server.id))
	return (
		<ItemDescription className="flex items-center gap-1.5">
			<StatusDot
				key={call}
				className={Boolean.match(call >= 0, {onFalse: () => undefined, onTrue: () => 'port-blink'})}
				status={pipe(
					Match.value(props.server.status),
					Match.when('Connected', () => 'live' as const),
					Match.when('Expired', () => 'error' as const),
					Match.orElse(() => 'off' as const)
				)}
			/>
			{props.server.status}
		</ItemDescription>
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

function RemoveDialog(props: {onOpenChange: (open: boolean) => void; open: boolean; server: ConnectionInfo}) {
	const [removing, remove] = useAtom(removeAtom(props.server.id))
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogTitle>Remove {props.server.name}?</DialogTitle>
				<DialogDescription>
					Its tools will no longer be available through the gateway. This does not revoke the provider’s grant.
				</DialogDescription>
				<ResultError result={removing} />
				<div className="flex justify-end gap-2">
					<DialogClose render={<Button variant="ghost" disabled={AsyncResult.isWaiting(removing)} />}>
						Cancel
					</DialogClose>
					<Button variant="destructive" disabled={AsyncResult.isWaiting(removing)} onClick={() => remove()}>
						Remove server
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}

// Each source in turn until one loads; the tile keeps a black favicon visible on the dark page.
function FirstImage(props: {sources: string[]}) {
	const [failed, setFailed] = useState(0)
	return Option.match(Array.get(props.sources, failed), {
		onNone: () => <Server className="text-muted-foreground size-5" />,
		onSome: src => (
			<span className="bg-icon-tile flex size-6 items-center justify-center overflow-hidden rounded-md">
				<img src={src} alt="" className="size-4" onError={() => setFailed(failed + 1)} />
			</span>
		)
	})
}

// Keyed by its sources, so icons a later discovery finds get their turn.
function ServerIcon(props: {server: ConnectionInfo}) {
	const host = new URL(props.server.url).hostname
	const sources = Array.dedupe([
		...Array.map(
			Array.sort(
				props.server.icons,
				Order.mapInput(Order.Boolean, (icon: ConnectionInfo['icons'][number]) => icon.theme === 'dark')
			),
			icon => icon.src
		),
		`https://${host}/favicon.ico`,
		`https://${String.replace(/^(?:api|app|mcp)\./u, '')(host)}/favicon.ico`
	])
	return <FirstImage key={Array.join(sources, ' ')} sources={sources} />
}

// One row: favicon, name and host, then its state and the one action it needs.
function ServerRow(props: {server: ConnectionInfo}) {
	const [disconnecting] = useAtom(disconnectAtom(props.server.id))
	const [removing] = useAtom(removeAtom(props.server.id))
	const [hiding] = useAtom(hideAtom(props.server.id))
	const [confirm, setConfirm] = useState(false)
	const busy = AsyncResult.isWaiting(disconnecting) || AsyncResult.isWaiting(removing) || AsyncResult.isWaiting(hiding)
	const shown = Array.filter(props.server.tools, tool => !Array.contains(props.server.hidden, tool))
	const failure = pipe(
		Option.fromUndefinedOr(props.server.error),
		Option.orElse(() => Option.map(AsyncResult.error(disconnecting), error => error.message)),
		Option.orElse(() => Option.map(AsyncResult.error(hiding), error => error.message))
	)
	return (
		<Item role="listitem">
			<ItemMedia>
				<ServerIcon server={props.server} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.server.name}</ItemTitle>
				<ItemDescription className="font-mono">{new URL(props.server.url).hostname}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Status server={props.server} />
				{pipe(
					Match.value(props.server.status),
					Match.when('Connected', () =>
						Array.match(props.server.tools, {
							onEmpty: () => null,
							onNonEmpty: tools => (
								<ItemDescription className="w-12 text-right font-mono">
									{shown.length}/{tools.length}
								</ItemDescription>
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
			</ItemActions>
			{Option.match(failure, {
				onNone: () => null,
				onSome: message => <FieldError className="basis-full break-words">{message}</FieldError>
			})}
			<RemoveDialog open={confirm} onOpenChange={setConfirm} server={props.server} />
		</Item>
	)
}

function AddForm(props: {url: string; error: string; adding: boolean}) {
	const send = useAtomSet(addAtom.send)
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={event => {
				event.preventDefault()
				send({_tag: 'Submit'})
			}}
		>
			<Field data-invalid={props.error !== ''}>
				<FieldLabel htmlFor="mcp-url">MCP URL</FieldLabel>
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
				/>
				<FieldError id="mcp-add-error">{props.error}</FieldError>
			</Field>
			{/* Outside the Field, whose invalid state would tint every control in it red. */}
			<div className="flex justify-end gap-2">
				<Button variant="ghost" type="button" disabled={props.adding} onClick={() => send({_tag: 'Cancel'})}>
					Cancel
				</Button>
				<Button type="submit" disabled={props.adding}>
					{Boolean.match(props.adding, {onFalse: () => 'Add server', onTrue: () => 'Adding…'})}
				</Button>
			</div>
		</form>
	)
}

// The endpoint agents connect to, copied in one click.
function Endpoint() {
	const [copied, copy] = useAtom(copyEndpointAtom)
	return (
		<Field className="max-w-sm">
			<InputGroup>
				<InputGroupInput readOnly value={ENDPOINT} aria-label="Gateway endpoint" />
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						size="icon-xs"
						onClick={() => copy()}
						disabled={AsyncResult.isWaiting(copied)}
						aria-label="Copy gateway endpoint"
					>
						{Boolean.match(AsyncResult.isSuccess(copied), {onFalse: () => <Copy />, onTrue: () => <Check />})}
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
			<ResultError result={copied} />
		</Field>
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
			{Array.match(props.servers, {
				onEmpty: () => (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No servers yet</EmptyTitle>
						</EmptyHeader>
					</Empty>
				),
				onNonEmpty: rows => (
					<ItemList label="MCP servers">
						{Array.map(rows, server => (
							<ServerRow key={server.id} server={server} />
						))}
					</ItemList>
				)
			})}
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
					if (error.error === 'access_denied') {
						return (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>Admins only</EmptyTitle>
									<EmptyDescription>{error.message}</EmptyDescription>
								</EmptyHeader>
							</Empty>
						)
					}
					return <SignIn href={signInUrl(location.href)} />
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
				<h1 className="text-xl font-semibold tracking-tight">Servers</h1>
				<Servers />
			</div>
		</main>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
