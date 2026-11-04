import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Option, Order, Schema, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Copy, Plus, Server} from 'lucide-react'
import {useState} from 'react'

import {AppBar, AppBarAction} from '@deslop/components-web/app-bar'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
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
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {useIsMobile} from '@deslop/components-web/ui/hooks/use-mobile'
import {Input} from '@deslop/components-web/ui/input'
import {cn} from '@deslop/components-web/utils'
import {AuthError} from '@deslop/runtime/auth/schema'
import {needsSignIn, signInUrl} from '@deslop/runtime/auth/utils'

import {addAtom, connectUrl, copyEndpointAtom, lastCallAtom, removeAtom, serversAtom} from '#lib/utils.ts'
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
				onSome: src => <img src={src} alt="" className="size-5 object-contain" onError={() => setFailed(failed + 1)} />
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

// One line per server: its icon, name, host or why it needs the user, its tool count and its light; the row selects it, its context menu removes it.
function ServerRow(props: {active: boolean; onSelect: () => void; server: ConnectionInfo}) {
	const [confirm, setConfirm] = useState(false)
	return (
		<div className="border-b">
			<RemoveDialog open={confirm} onOpenChange={setConfirm} server={props.server} />
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<Button
							size="lg"
							variant={Boolean.match(props.active, {
								onFalse: () => 'ghost' as const,
								onTrue: () => 'secondary' as const
							})}
							className="w-full justify-start text-left"
							aria-current={Boolean.match(props.active, {onFalse: () => undefined, onTrue: () => 'true' as const})}
							onClick={props.onSelect}
						>
							<ServerIcon server={props.server} />
							<span className="min-w-0 shrink-0 truncate font-medium">{props.server.name}</span>
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
						</Button>
					}
				/>
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

function ServersPane(props: {
	activeId?: string
	className?: string
	onSelect: (server: ConnectionInfo) => void
	servers: readonly ConnectionInfo[]
}) {
	return (
		<section
			aria-label="MCP servers"
			className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
		>
			{Array.match(props.servers, {
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
							<ServerRow
								key={server.id}
								active={props.activeId === server.id}
								onSelect={() => props.onSelect(server)}
								server={server}
							/>
						))}
					</div>
				)
			})}
		</section>
	)
}

// The chosen server: where it lives, its light and fix, its full error, and every tool it offers.
function ServerPane(props: {className?: string; server?: ConnectionInfo}) {
	const [confirm, setConfirm] = useState(false)
	return Option.match(Option.fromUndefinedOr(props.server), {
		onNone: () => (
			<section aria-label="Server" className={cn('flex min-h-0 flex-col', props.className)}>
				<Empty>
					<EmptyHeader>
						<EmptyTitle>Select a server</EmptyTitle>
					</EmptyHeader>
				</Empty>
			</section>
		),
		onSome: server => (
			<section
				aria-label={server.name}
				className={cn('pb-safe-bottom flex min-h-0 flex-col overflow-y-auto', props.className)}
			>
				<RemoveDialog open={confirm} onOpenChange={setConfirm} server={server} />
				<ContextMenu>
					<ContextMenuTrigger
						render={<header className="bg-background sticky top-0 z-20 flex shrink-0 flex-col gap-2 border-b p-3" />}
					>
						<div className="flex min-w-0 items-start gap-3">
							<ServerIcon server={server} />
							<div className="min-w-0 flex-1">
								<h2 className="truncate text-sm font-semibold">{server.name}</h2>
								<a
									href={server.url}
									target="_blank"
									rel="noreferrer"
									className="text-muted-foreground block truncate font-mono text-xs hover:underline"
									title={server.url}
								>
									{new URL(server.url).hostname}
								</a>
							</div>
							<span
								role="img"
								title={server.status}
								aria-label={server.status}
								className="flex size-3 shrink-0 items-center justify-center"
							>
								<Status server={server} />
							</span>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{(server.status !== 'Connected' || server.error !== undefined) && (
								<Button size="sm" onClick={() => location.assign(connectUrl(server.id))}>
									{Boolean.match(server.status === 'Not connected', {
										onFalse: () => 'Reconnect',
										onTrue: () => 'Connect'
									})}
								</Button>
							)}
							<span className="text-muted-foreground text-xs">{server.status}</span>
							{Array.isReadonlyArrayNonEmpty(server.tools) && (
								<span className="text-muted-foreground text-xs">
									· {server.tools.length} tool
									{Boolean.match(server.tools.length === 1, {onFalse: () => 's', onTrue: () => ''})}
								</span>
							)}
						</div>
						{server.error !== undefined && <FieldError className="wrap-anywhere">{server.error}</FieldError>}
					</ContextMenuTrigger>
					<ContextMenuContent className="w-auto min-w-36">
						<ContextMenuItem variant="destructive" onClick={() => setConfirm(true)}>
							Remove
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
				<section aria-label="Tools" className="flex min-h-0 flex-col gap-1 p-3">
					<h3 className="text-muted-foreground text-xs font-medium">Tools</h3>
					{Array.match(server.tools, {
						onEmpty: () => (
							<Empty>
								<EmptyHeader>
									<EmptyTitle>No tools yet</EmptyTitle>
									<EmptyDescription>
										{Boolean.match(server.status === 'Connected', {
											onFalse: () => 'Connect the server to discover its tools.',
											onTrue: () => 'This server reports no tools.'
										})}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						),
						onNonEmpty: tools => (
							<ul aria-label={`Tools of ${server.name}`}>
								{Array.map(tools, tool => (
									<li key={tool} className="border-b py-2 font-mono text-xs select-text">
										{tool}
									</li>
								))}
							</ul>
						)
					})}
				</section>
			</section>
		)
	})
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

// A failure the page can't show as data: an admin's refusal, a sign-in, then anything else.
function FailureContent(props: {error: unknown}) {
	if (!Schema.is(AuthError)(props.error)) return <Error error={props.error} reset={() => location.reload()} />
	if (props.error.error === 'access_denied') {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>Admins only</EmptyTitle>
					<EmptyDescription>{props.error.message}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		)
	}
	if (!needsSignIn(props.error)) return <Error error={props.error} reset={() => location.reload()} />
	return <SignIn href={signInUrl(location.href)} />
}

function Home() {
	const send = useAtomSet(addAtom.send)
	const copy = useAtomSet(copyEndpointAtom)
	const isMobile = useIsMobile()
	const [pane, setPane] = useState<'server' | 'servers'>('servers')
	const [selection, setSelection] = useState<string>()
	const servers = useAtomValue(serversAtom)
	const value = AsyncResult.value(servers)
	const error = AsyncResult.error(servers)
	const authFailure = Option.filter(error, Schema.is(AuthError))
	const sorted = Array.sort(
		Option.getOrElse(value, () => Array.empty<ConnectionInfo>()),
		urgency
	)
	const active = Option.orElse(
		Option.flatMap(Option.fromUndefinedOr(selection), id => Array.findFirst(sorted, server => server.id === id)),
		() => Array.head(sorted)
	)
	const ready = Option.isSome(value)

	function selectServer(server: ConnectionInfo) {
		setSelection(server.id)
		setPane('server')
	}

	const needsYou: PaletteGroup = {
		items: Array.map(
			Array.filter(sorted, server => server.status !== 'Connected' || server.error !== undefined),
			server => ({
				detail: reasonText(server),
				icon: <ServerIcon server={server} />,
				id: server.id,
				keywords: `${server.name} ${server.url}`,
				label: server.name,
				run: () => selectServer(server)
			})
		),
		label: 'Needs you'
	}
	const all: PaletteGroup = {
		items: Array.map(sorted, server => ({
			detail: new URL(server.url).hostname,
			icon: <ServerIcon server={server} />,
			keywords: `${server.name} ${server.url} ${Array.join(server.tools, ' ')}`,
			label: server.name,
			run: () => selectServer(server)
		})),
		label: 'Servers'
	}
	const actions: PaletteGroup = {
		items: [
			...Boolean.match(ready, {
				onFalse: () => [],
				onTrue: () => [{icon: <Plus />, label: 'Add server', run: () => send({_tag: 'Open' as const})}]
			}),
			{icon: <Copy />, label: 'Copy MCP URL', run: () => copy()}
		],
		label: 'Actions'
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="gateway"
				title={Boolean.match(isMobile, {
					onFalse: () => undefined,
					onTrue: () =>
						pipe(
							Match.value(pane),
							Match.when('server', () => Option.match(active, {onNone: () => 'Server', onSome: server => server.name})),
							Match.orElse(() => 'gateway')
						)
				})}
				back={Boolean.match(isMobile && pane === 'server', {
					onFalse: () => undefined,
					onTrue: () => ({label: 'Servers', onClick: () => setPane('servers')})
				})}
				palette={[needsYou, all, actions]}
				action={
					<>
						<AppBarAction icon={<Copy />} label="Copy MCP URL" variant="outline" onClick={() => copy()} />
						{ready && <AppBarAction icon={<Plus />} label="Add server" onClick={() => send({_tag: 'Open'})} />}
					</>
				}
			/>
			{Option.match(authFailure, {
				onNone: () =>
					Option.match(value, {
						onNone: () =>
							Option.match(error, {
								onNone: () => (
									<div className="p-4">
										<ItemListSkeleton label="MCP servers" media rows={4} />
									</div>
								),
								onSome: cause => <FailureContent error={cause} />
							}),
						onSome: () => (
							<div className="flex min-h-0 flex-1">
								{Boolean.match(isMobile, {
									onFalse: () => (
										<>
											<ServersPane
												activeId={Option.getOrUndefined(active)?.id}
												className="w-72 shrink-0 border-r"
												onSelect={selectServer}
												servers={sorted}
											/>
											<ServerPane className="min-w-0 flex-1" server={Option.getOrUndefined(active)} />
										</>
									),
									onTrue: () =>
										pipe(
											Match.value(pane),
											Match.when('server', () => (
												<ServerPane className="min-h-0 flex-1" server={Option.getOrUndefined(active)} />
											)),
											Match.orElse(() => (
												<ServersPane
													activeId={Option.getOrUndefined(active)?.id}
													className="min-h-0 flex-1"
													onSelect={selectServer}
													servers={sorted}
												/>
											))
										)
								})}
							</div>
						)
					}),
				onSome: cause => <FailureContent error={cause} />
			})}
			<AddDialog />
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
