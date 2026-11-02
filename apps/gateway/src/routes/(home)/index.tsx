import {useAtom, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Option, Order, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Copy, Plus, Server} from 'lucide-react'
import {Suspense, useState} from 'react'

import {AppBar, AppBarAction, useCommandQuery} from '@deslop/components-web/app-bar'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemList, ItemListSkeleton} from '@deslop/components-web/item-list'
import {Page} from '@deslop/components-web/page'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle
} from '@deslop/components-web/ui/dialog'
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

import {addAtom, connectUrl, copyEndpointAtom, hideAtom, lastCallAtom, removeAtom, serversAtom} from '#lib/utils.ts'
import icon from '#routes/icon-dark.svg'
import type {ConnectionInfo} from '#services/connections/schema.ts'

// What needs the user first: an expired sign-in or a failure, then a server never connected, then the live ones.
const urgency = Order.mapInput(Order.Number, (server: ConnectionInfo) =>
	pipe(
		Match.value(server.status),
		Match.when('Expired', () => 0),
		Match.when(
			() => server.error !== undefined,
			() => 0
		),
		Match.when('Not connected', () => 1),
		Match.orElse(() => 2)
	)
)

// Live in the primary, expired red, not connected hollow; like a port light it dims per tool call, a new key replaying it.
function Status(props: {server: ConnectionInfo}) {
	const call = useAtomValue(lastCallAtom(props.server.id))
	return (
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
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" disabled={AsyncResult.isWaiting(removing)} />}>
						Cancel
					</DialogClose>
					<Button variant="destructive" disabled={AsyncResult.isWaiting(removing)} onClick={() => remove()}>
						Remove server
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// Each source in turn until one loads; the tile keeps a black favicon visible on the dark page.
function FirstImage(props: {sources: string[]}) {
	const [failed, setFailed] = useState(0)
	return Option.match(Array.get(props.sources, failed), {
		onNone: () => <Server className="text-muted-foreground size-6" />,
		onSome: src => (
			<span className="bg-icon-tile flex size-8 items-center justify-center overflow-hidden rounded-md">
				<img src={src} alt="" className="size-6" onError={() => setFailed(failed + 1)} />
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
				Order.mapInput(Order.Boolean, (entry: ConnectionInfo['icons'][number]) => entry.theme === 'dark')
			),
			entry => entry.src
		),
		`https://${host}/favicon.ico`,
		`https://${String.replace(/^(?:api|app|mcp)\./u, '')(host)}/favicon.ico`
	])
	return <FirstImage key={Array.join(sources, ' ')} sources={sources} />
}

// Why a server needs the user, in place of its host: the failure it last reported, else its state.
function Reason(props: {failure: Option.Option<string>; server: ConnectionInfo}) {
	return Option.match(props.failure, {
		onNone: () =>
			pipe(
				Match.value(props.server.status),
				Match.when('Expired', () => <ItemDescription className="text-destructive">Sign-in expired</ItemDescription>),
				Match.when('Not connected', () => <ItemDescription>Not connected</ItemDescription>),
				Match.orElse(() => (
					<ItemDescription className="font-mono">{new URL(props.server.url).hostname}</ItemDescription>
				))
			),
		onSome: message => <ItemDescription className="text-destructive break-words">{message}</ItemDescription>
	})
}

// One row: favicon, name and host or the reason it needs the user, its fix when it has one, and its light. Right-click or long-press for its tools and Remove.
function ServerRow(props: {server: ConnectionInfo}) {
	const [removing] = useAtom(removeAtom(props.server.id))
	const [hiding, hide] = useAtom(hideAtom(props.server.id))
	const [confirm, setConfirm] = useState(false)
	const busy = AsyncResult.isWaiting(removing) || AsyncResult.isWaiting(hiding)
	return (
		<>
			<RemoveDialog open={confirm} onOpenChange={setConfirm} server={props.server} />
			<ContextMenu>
				{/* The row keeps the Item slot, which the list's hairline layout targets, over the trigger's own. */}
				{/* Focusable, so the keyboard's menu key or Shift+F10 opens the same menu. */}
				<ContextMenuTrigger render={trigger => <Item {...trigger} role="listitem" tabIndex={0} data-slot="item" />}>
					<ItemMedia>
						<ServerIcon server={props.server} />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{props.server.name}</ItemTitle>
						<Reason
							failure={pipe(
								Option.fromUndefinedOr(props.server.error),
								Option.orElse(() => Option.map(AsyncResult.error(hiding), error => error.message))
							)}
							server={props.server}
						/>
					</ItemContent>
					<ItemActions>
						{(props.server.status !== 'Connected' || props.server.error !== undefined) && (
							<Button
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => location.assign(connectUrl(props.server.id))}
							>
								{Boolean.match(props.server.status === 'Not connected', {
									onFalse: () => 'Reconnect',
									onTrue: () => 'Connect'
								})}
							</Button>
						)}
						<Status server={props.server} />
					</ItemActions>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					{/* Agents see only the checked tools. */}
					{Array.isReadonlyArrayNonEmpty(props.server.tools) && (
						<ContextMenuSub>
							<ContextMenuSubTrigger>Tools</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								{Array.map(props.server.tools, tool => (
									<ContextMenuCheckboxItem
										key={tool}
										checked={!Array.contains(props.server.hidden, tool)}
										onCheckedChange={visible => hide({hidden: !visible, tool})}
									>
										<span className="font-mono">{tool}</span>
									</ContextMenuCheckboxItem>
								))}
							</ContextMenuSubContent>
						</ContextMenuSub>
					)}
					<ContextMenuItem variant="destructive" disabled={busy} onClick={() => setConfirm(true)}>
						Remove
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</>
	)
}

function AddForm(props: {url: string; error: string; adding: boolean}) {
	const send = useAtomSet(addAtom.send)
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={event => {
				event.preventDefault()
				send({_tag: 'Submit'})
			}}
		>
			<DialogTitle>Add a server</DialogTitle>
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
			<DialogFooter>
				<DialogClose render={<Button variant="ghost" type="button" disabled={props.adding} />}>Cancel</DialogClose>
				<Button type="submit" disabled={props.adding}>
					{Boolean.match(props.adding, {onFalse: () => 'Add server', onTrue: () => 'Adding…'})}
				</Button>
			</DialogFooter>
		</form>
	)
}

// One dialog while the URL is edited or added, so a submit or a failure only changes the form; it closes once the server is added, or on Cancel.
function AddDialog() {
	const send = useAtomSet(addAtom.send)
	const editing = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(addAtom, 'Editing')), Option.none)
	const adding = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(addAtom, 'Adding')), Option.none)
	const form = Option.orElse(
		Option.map(editing, state => ({adding: false, error: state.error, url: state.url})),
		() => Option.map(adding, state => ({adding: true, error: '', url: state.url}))
	)
	return (
		<Dialog
			open={Option.isSome(form)}
			onOpenChange={open => {
				if (!open && Option.isSome(editing)) send({_tag: 'Cancel'})
			}}
		>
			<DialogContent showCloseButton={Option.isNone(adding)}>
				{Option.match(form, {onNone: () => null, onSome: values => <AddForm {...values} />})}
			</DialogContent>
		</Dialog>
	)
}

function Directory(props: {servers: readonly ConnectionInfo[]}) {
	const query = useCommandQuery()
	return Array.match(
		Array.filter(Array.sort(props.servers, urgency), server =>
			String.includes(query)(String.toLowerCase(`${server.name} ${server.url}`))
		),
		{
			onEmpty: () => (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>
							{Boolean.match(query === '', {onFalse: () => 'No server matches', onTrue: () => 'No servers yet'})}
						</EmptyTitle>
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
		}
	)
}

// The servers need a Deslop sign-in by an admin; GitHub returns here once it is done.
function Servers() {
	const servers = useAtomSuspense(serversAtom, {includeFailure: true})
	if (AsyncResult.isSuccess(servers)) return <Directory servers={servers.value} />
	return Option.match(Cause.findErrorOption(servers.cause), {
		onNone: () => <Error error={Cause.squash(servers.cause)} reset={() => location.reload()} />,
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
			if (!needsSignIn(error)) return <Error error={error} reset={() => location.reload()} />
			return <SignIn href={signInUrl(location.href)} />
		}
	})
}

// The first load suspends to a skeleton; React keeps a shown fallback at least 300ms, so it never blinks.
function Home() {
	const send = useAtomSet(addAtom.send)
	const copy = useAtomSet(copyEndpointAtom)
	// Adding a server needs the admin's list, so the bar offers it only once that list has loaded.
	const ready = AsyncResult.isSuccess(useAtomValue(serversAtom))
	return (
		<>
			<AppBar
				icon={icon}
				name="gateway"
				commands={Array.filter(
					[
						{icon: <Plus />, label: 'Add server', run: () => send({_tag: 'Open'})},
						{icon: <Copy />, label: 'Copy endpoint', run: () => copy()}
					],
					command => ready || command.label === 'Copy endpoint'
				)}
				action={ready && <AppBarAction icon={<Plus />} label="Add server" onClick={() => send({_tag: 'Open'})} />}
			/>
			<Page>
				<Suspense fallback={<ItemListSkeleton label="MCP servers" media rows={4} />}>
					<Servers />
				</Suspense>
			</Page>
			<AddDialog />
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
