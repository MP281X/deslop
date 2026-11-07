import {useAtom, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Option, Order, Schema, String, pipe} from 'effect'

import {CatchBoundary, createFileRoute} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Check, Copy, OctagonAlert, Plus, Server} from 'lucide-react'
import {Suspense, useState} from 'react'

import {AppBar, AppBarAction} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Alert, AlertDescription, AlertTitle} from '@deslop/components-web/ui/alert'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
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
import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {formatError} from '@deslop/components-web/utils'
import {AuthError} from '@deslop/runtime/auth/schema'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

import {addAtom, connectUrl, copyAtom, ENDPOINT, lastCallAtom, removeAtom, serversAtom} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
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

// A failure the page can't show as data: an admin's refusal, a sign-in, then anything else.
function FailureContent(props: {error: unknown; reset: () => void}) {
	if (!Schema.is(AuthError)(props.error)) return <Error error={props.error} reset={props.reset} />
	if (props.error.error === 'access_denied') {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Admins only</EmptyTitle>
					<EmptyDescription>{props.error.message}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button variant="outline" onClick={props.reset}>
						Try again
					</Button>
				</EmptyContent>
			</Empty>
		)
	}
	if (!needsSignIn(props.error)) return <Error error={props.error} reset={props.reset} />
	return <SignIn href={signInUrl(location.href)} />
}

// Live in the primary, expired red, not connected hollow; like a port light it dims per tool call, a new key replaying it.
function Status(props: {server: ConnectionInfo}) {
	const call = useAtomValue(lastCallAtom(props.server.id))
	return (
		<StatusDot
			key={call}
			className={Boolean.match(call >= 0, {onFalse: () => undefined, onTrue: () => 'animate-port-blink'})}
			status={pipe(
				Match.value(props.server.status),
				Match.when('Connected', () => 'live' as const),
				Match.when('Expired', () => 'error' as const),
				Match.orElse(() => 'off' as const)
			)}
		/>
	)
}

// A server's own words for why it needs the user, or its host when it is fine.
function reasonText(server: ConnectionInfo) {
	return pipe(
		Match.value(server.status),
		Match.when('Expired', () => 'Sign-in expired'),
		Match.when('Not connected', () => 'Not connected'),
		Match.orElse(() => new URL(server.url).hostname)
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

// Each source in turn until one loads, drawn as the server ships it, without a tile behind it.
function FirstImage(props: {sources: string[]}) {
	const [failed, setFailed] = useState(0)
	return (
		<span className="flex size-5 shrink-0 items-center justify-center">
			{Option.match(Array.get(props.sources, failed), {
				onNone: () => <Server className="text-muted-foreground size-4" />,
				onSome: src => (
					<img src={src} alt="" className="size-full object-contain" onError={() => setFailed(failed + 1)} />
				)
			})}
		</span>
	)
}

// Keyed by its sources, so icons a later discovery finds get their turn. Without a tile behind it, an icon drawn for dark backgrounds goes first.
function ServerIcon(props: {server: ConnectionInfo}) {
	const host = new URL(props.server.url).hostname
	const sources = Array.dedupe([
		...Array.map(
			Array.sort(
				props.server.icons,
				Order.mapInput(Order.Boolean, (entry: ConnectionInfo['icons'][number]) => entry.theme !== 'dark')
			),
			entry => entry.src
		),
		`https://${host}/favicon.ico`,
		`https://${String.replace(/^(?:api|app|mcp)\./u, '')(host)}/favicon.ico`
	])
	return <FirstImage key={Array.join(sources, ' ')} sources={sources} />
}

// A state that needs the user takes the host's place; a reported failure shows in full beneath the row.
function Reason(props: {server: ConnectionInfo}) {
	return pipe(
		Match.value(props.server.status),
		Match.when('Expired', () => <span className="text-destructive truncate">Sign-in expired</span>),
		Match.when('Not connected', () => <span className="text-muted-foreground truncate">Not connected</span>),
		Match.orElse(() => (
			<span className="text-muted-foreground truncate font-mono text-xs">{new URL(props.server.url).hostname}</span>
		))
	)
}

// The page has no detail pane, so a palette pick brings its row into view.
function focusServer(server: ConnectionInfo) {
	const row = document.getElementById(`server-${server.id}`)
	row?.focus()
	row?.scrollIntoView({block: 'center'})
}

// One line per server: its icon, name, host or why it needs the user, its tool count, its light, and Connect when it needs one; its context menu removes it.
function ServerRow(props: {server: ConnectionInfo}) {
	const [confirm, setConfirm] = useState(false)
	const connected = props.server.status === 'Connected'
	return (
		<div role="listitem" className="border-b">
			<RemoveDialog open={confirm} onOpenChange={setConfirm} server={props.server} />
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<div
							id={`server-${props.server.id}`}
							role="button"
							tabIndex={0}
							aria-haspopup="menu"
							aria-label={`${props.server.name}, ${reasonText(props.server)}`}
							className="hover:bg-muted/50 focus-visible:ring-ring/30 flex h-8 items-center gap-2 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset max-sm:h-11"
						/>
					}
				>
					<ServerIcon server={props.server} />
					<span className="max-w-56 min-w-0 shrink truncate text-sm font-medium">{props.server.name}</span>
					<span className="flex min-w-0 flex-1">
						<Reason server={props.server} />
					</span>
					{Array.isReadonlyArrayNonEmpty(props.server.tools) && (
						<span className="text-muted-foreground shrink-0 font-mono text-xs max-sm:hidden" title="Tools">
							{Boolean.match(props.server.tools.length === 1, {
								onFalse: () => `${props.server.tools.length} tools`,
								onTrue: () => '1 tool'
							})}
						</span>
					)}
					<span
						role="img"
						title={props.server.status}
						aria-label={props.server.status}
						className="flex size-3 shrink-0 items-center justify-center"
					>
						<Status server={props.server} />
					</span>
					{(!connected || props.server.error !== undefined) && (
						<Button
							variant="ghost"
							size="sm"
							className="max-sm:h-11"
							onClick={() => location.assign(connectUrl(props.server.id))}
						>
							{Boolean.match(props.server.status === 'Not connected', {
								onFalse: () => 'Reconnect',
								onTrue: () => 'Connect'
							})}
						</Button>
					)}
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					<ContextMenuItem variant="destructive" onClick={() => setConfirm(true)}>
						Remove
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{props.server.error !== undefined && (
				<FieldError className="mr-1 mb-2 ml-9 wrap-anywhere">{props.server.error}</FieldError>
			)}
		</div>
	)
}

function ServerRowsSkeleton() {
	return (
		<div aria-busy="true" role="status" aria-label="MCP servers">
			{Array.map(Array.range(1, 5), row => (
				<div key={row} aria-hidden className="border-b">
					<div className="flex h-8 items-center gap-2 px-3 max-sm:h-11">
						<Skeleton className="size-5 shrink-0" />
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="h-3 flex-1" />
						<Skeleton className="size-2.5 shrink-0" />
					</div>
				</div>
			))}
		</div>
	)
}

function ServersContent() {
	const result = useAtomSuspense(serversAtom, {includeFailure: true})
	const refresh = useAtomRefresh(serversAtom)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<>
			{AsyncResult.isFailure(result) && (
				<div className="shrink-0 px-3 py-2">
					<Alert variant="destructive">
						<OctagonAlert />
						<AlertTitle>Servers may be out of date</AlertTitle>
						<AlertDescription className="wrap-anywhere whitespace-pre-wrap">
							{formatError(result.cause)}
							<Button variant="outline" size="sm" onClick={refresh}>
								Try again
							</Button>
						</AlertDescription>
					</Alert>
				</div>
			)}
			{Option.getOrUndefined(
				Option.map(value, current =>
					Array.match(Array.sort(current, urgency), {
						onEmpty: () => (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>No servers yet</EmptyTitle>
									<EmptyDescription>Add one from the bar to offer its tools.</EmptyDescription>
								</EmptyHeader>
							</Empty>
						),
						onNonEmpty: servers => (
							<div role="list" aria-label="MCP servers">
								{Array.map(servers, server => (
									<ServerRow key={server.id} server={server} />
								))}
							</div>
						)
					})
				)
			)}
		</>
	)
}

// The page is the list: one column of servers, centered at reading width on a wide screen.
function ServersPane(props: {count?: number; pending: boolean}) {
	return (
		<section aria-label="MCP servers" className="pb-safe-bottom flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
				<header className="bg-background sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 border-b px-3">
					<span className="text-sm font-semibold">Servers</span>
					<span className="text-muted-foreground font-mono text-xs">
						{Boolean.match(props.pending, {onFalse: () => props.count, onTrue: () => <Skeleton className="h-3 w-4" />})}
					</span>
				</header>
				<CatchBoundary getResetKey={() => 'servers'} errorComponent={FailureContent}>
					<Suspense fallback={<ServerRowsSkeleton />}>
						<ServersContent />
					</Suspense>
				</CatchBoundary>
			</div>
		</section>
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

function Home() {
	const send = useAtomSet(addAtom.send)
	const [copy, copyText] = useAtom(copyAtom(ENDPOINT))
	const copied = AsyncResult.isWaiting(copy)
	const servers = useAtomValue(serversAtom)
	const value = AsyncResult.value(servers)
	const authFailure = Option.filter(AsyncResult.error(servers), isDenied)
	const sorted = Array.sort(
		Option.getOrElse(value, () => Array.empty<ConnectionInfo>()),
		urgency
	)
	const ready = Option.isNone(authFailure) && Option.isSome(value)

	const needsYou: PaletteGroup = {
		items: Array.map(
			Array.filter(sorted, server => server.status !== 'Connected' || server.error !== undefined),
			server => ({
				detail: reasonText(server),
				icon: <ServerIcon server={server} />,
				id: server.id,
				keywords: `${server.name} ${server.url}`,
				label: server.name,
				run: () => focusServer(server)
			})
		),
		label: 'Needs you'
	}
	const all: PaletteGroup = {
		items: Array.map(sorted, server => ({
			detail: new URL(server.url).hostname,
			icon: <ServerIcon server={server} />,
			id: server.id,
			keywords: `${server.name} ${server.url} ${Array.join(
				Array.map(server.tools, tool => tool.name),
				' '
			)}`,
			label: server.name,
			run: () => focusServer(server)
		})),
		label: 'Servers'
	}
	const actions: PaletteGroup = {
		items: [
			...Boolean.match(ready, {
				onFalse: () => [],
				onTrue: () => [{icon: <Plus />, label: 'Add server', run: () => send({_tag: 'Open' as const})}]
			}),
			{
				icon: Boolean.match(copied, {onFalse: () => <Copy />, onTrue: () => <Check className="text-primary" />}),
				label: 'Copy MCP URL',
				run: () => copyText()
			}
		],
		label: 'Actions'
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="gateway"
				palette={Boolean.match(Option.isSome(authFailure), {
					onFalse: () => [actions, needsYou, all, otherApps('gateway')],
					onTrue: () => [otherApps('gateway')]
				})}
				action={
					<>
						<AppBarAction
							icon={Boolean.match(copied, {onFalse: () => <Copy />, onTrue: () => <Check className="text-primary" />})}
							label="Copy MCP URL"
							variant="outline"
							onClick={() => copyText()}
						/>
						<AppBarAction disabled={!ready} icon={<Plus />} label="Add server" onClick={() => send({_tag: 'Open'})} />
					</>
				}
			/>
			<ServersPane
				count={Option.getOrUndefined(
					Option.map(
						Option.filter(value, () => Option.isNone(authFailure)),
						connections => connections.length
					)
				)}
				pending={AsyncResult.isInitial(servers)}
			/>
			<AddDialog />
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
