import {useAtom, useAtomSet, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {Navigate, createFileRoute} from '@tanstack/react-router'
import {MachineState} from '@typeonce/effect-machine-react'
import {AsyncResult} from 'effect/reactivity'
import {Check, Copy, Ellipsis} from 'lucide-react'
import {Suspense, useState} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
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
import {Input} from '@deslop/components-web/ui/input'

import {
	accountAtom,
	copyGatewayAtom,
	mcpAddAtom,
	mcpConnectUrl,
	mcpDisconnectAtom,
	mcpHideAtom,
	mcpRemoveAtom,
	mcpServersAtom
} from '#lib/utils.ts'
import type {ConnectionInfo} from '#services/connections/schema.ts'

function ServerRow(props: {server: ConnectionInfo}) {
	const [disconnecting, disconnect] = useAtom(mcpDisconnectAtom(props.server.id))
	const [removing, remove] = useAtom(mcpRemoveAtom(props.server.id))
	const [hiding, hide] = useAtom(mcpHideAtom(props.server.id))
	const [confirm, setConfirm] = useState(false)
	const busy = AsyncResult.isWaiting(disconnecting) || AsyncResult.isWaiting(removing) || AsyncResult.isWaiting(hiding)
	const connected = props.server.status === 'Connected'
	const shown = Array.filter(props.server.tools, tool => !Array.contains(props.server.hidden, tool))
	return (
		<li className="flex items-center gap-3 text-xs">
			<div className="flex min-w-0 grow flex-col">
				<span className="truncate">{props.server.name}</span>
				<span className="text-muted-foreground break-words">
					{new URL(props.server.url).hostname} ·{' '}
					<span className={Boolean.match(connected, {onFalse: () => 'text-primary', onTrue: () => ''})}>
						{Boolean.match(connected && Array.isReadonlyArrayNonEmpty(props.server.tools), {
							onFalse: () => props.server.status,
							onTrue: () => `${shown.length} of ${props.server.tools.length} tools`
						})}
					</span>
				</span>
				{Option.match(Option.fromUndefinedOr(props.server.error), {
					onNone: () => null,
					onSome: error => <span className="text-destructive break-words">{error}</span>
				})}
				{Option.match(AsyncResult.error(disconnecting), {
					onNone: () => null,
					onSome: failure => (
						<span className="text-destructive" role="alert">
							{failure.message}
						</span>
					)
				})}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${props.server.name}`} disabled={busy} />}
				>
					<Ellipsis />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-auto min-w-36">
					<DropdownMenuItem onClick={() => location.assign(mcpConnectUrl(props.server.id))}>
						{Boolean.match(props.server.status === 'Not connected', {
							onFalse: () => 'Reconnect',
							onTrue: () => 'Connect'
						})}
					</DropdownMenuItem>
					{connected && <DropdownMenuItem onClick={() => disconnect()}>Disconnect</DropdownMenuItem>}
					{/* Agents see only the checked tools. */}
					{Array.isReadonlyArrayNonEmpty(props.server.tools) && (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>Tools</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								{Array.map(props.server.tools, tool => (
									<DropdownMenuCheckboxItem
										key={tool}
										checked={!Array.contains(props.server.hidden, tool)}
										onCheckedChange={visible =>
											hide(
												Boolean.match(visible, {
													onFalse: () => [...props.server.hidden, tool],
													onTrue: () => Array.filter(props.server.hidden, name => name !== tool)
												})
											)
										}
									>
										{tool}
									</DropdownMenuCheckboxItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					)}
					<DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
						Remove
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={confirm} onOpenChange={setConfirm}>
				<DialogContent className="text-xs">
					<DialogTitle>Remove {props.server.name}?</DialogTitle>
					<DialogDescription>
						Its tools will no longer be available through the gateway. This does not revoke the provider’s grant.
					</DialogDescription>
					{Option.match(AsyncResult.error(removing), {
						onNone: () => null,
						onSome: failure => (
							<p className="text-destructive" role="alert">
								{failure.message}
							</p>
						)
					})}
					<div className="flex justify-end gap-1.5">
						<DialogClose render={<Button variant="ghost" size="sm" disabled={busy} />}>Cancel</DialogClose>
						<Button variant="destructive" size="sm" disabled={busy} onClick={() => remove()}>
							Remove
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</li>
	)
}

function AddForm(props: {url: string; error: string; adding: boolean}) {
	const send = useAtomSet(mcpAddAtom.send)
	return (
		<form
			className="mb-4 flex flex-col gap-2 text-xs"
			onSubmit={event => {
				event.preventDefault()
				send({_tag: 'Submit'})
			}}
		>
			<label className="text-muted-foreground" htmlFor="mcp-url">
				MCP URL
			</label>
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
			{props.error !== '' && (
				<p className="text-destructive" role="alert" id="mcp-add-error">
					{props.error}
				</p>
			)}
			<div className="flex justify-end gap-1.5">
				<Button size="sm" variant="ghost" type="button" disabled={props.adding} onClick={() => send({_tag: 'Cancel'})}>
					Cancel
				</Button>
				<Button size="sm" type="submit" disabled={props.adding}>
					{Boolean.match(props.adding, {onFalse: () => 'Add', onTrue: () => 'Adding…'})}
				</Button>
			</div>
		</form>
	)
}

function Directory() {
	const servers = useAtomSuspense(mcpServersAtom).value
	const send = useAtomSet(mcpAddAtom.send)
	const [copied, copy] = useAtom(copyGatewayAtom)
	return (
		<>
			<section className="flex flex-col gap-2" aria-label="MCP servers">
				<div className="flex h-7 items-center justify-between gap-3">
					<h2 className="text-muted-foreground text-xs tracking-wider uppercase">Servers · {servers.length}</h2>
					<MachineState machine={mcpAddAtom} path="Closed">
						{() => (
							<Button size="sm" variant="secondary" onClick={() => send({_tag: 'Open'})}>
								Add
							</Button>
						)}
					</MachineState>
				</div>
				<MachineState machine={mcpAddAtom} path="Editing">
					{state => <AddForm url={state.value.url} error={state.value.error} adding={false} />}
				</MachineState>
				<MachineState machine={mcpAddAtom} path="Adding">
					{state => <AddForm url={state.value.url} error="" adding />}
				</MachineState>
				{Array.match(servers, {
					onEmpty: () => <p className="text-muted-foreground text-xs">No MCP servers added</p>,
					onNonEmpty: rows => (
						<ul className="flex flex-col gap-3">
							{Array.map(rows, server => (
								<ServerRow key={server.id} server={server} />
							))}
						</ul>
					)
				})}
			</section>
			<section className="mt-2 flex flex-col gap-2" aria-label="Gateway endpoint">
				<h2 className="text-muted-foreground text-xs tracking-wider uppercase">Gateway endpoint</h2>
				<div className="flex items-center gap-1.5">
					<Input aria-label="Gateway endpoint" value="https://auth.mp281x.xyz/mcp" readOnly />
					<Button
						variant="secondary"
						size="icon"
						aria-label="Copy gateway endpoint"
						disabled={AsyncResult.isWaiting(copied)}
						onClick={() => copy()}
					>
						{Boolean.match(AsyncResult.isSuccess(copied), {onFalse: () => <Copy />, onTrue: () => <Check />})}
					</Button>
				</div>
			</section>
			{Option.match(AsyncResult.error(copied), {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-xs" role="alert">
						{failure.message}
					</p>
				)
			})}
		</>
	)
}

function McpServers() {
	if (!Option.exists(useAtomSuspense(accountAtom).value, signed => signed.role === 'Admin')) return <Navigate to="/" />
	return (
		<Suspense fallback={<Loading />}>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/mcp-servers')({component: McpServers})
