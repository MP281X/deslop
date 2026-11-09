import {useAtom, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Option, Order, Schema, String, pipe} from 'effect'

import {CopyIcon, HardDrivesIcon, KeyIcon, PlusIcon, SparkleIcon} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {otherApps} from '@deslop/components-web/command-palette'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Page, Section, Stat} from '@deslop/components-web/page'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
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
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {cn} from '@deslop/components-web/utils'
import {isDenied} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {
	addAtom,
	connectUrl,
	copyAtom,
	ENDPOINT,
	lastCallAtom,
	Period,
	removeAtom,
	serversAtom,
	setKeyAtom
} from '#lib/utils.ts'
import {AddKeyDialog, AiControls, AiPane, PROVIDERS} from '#routes/(home)/-ai.tsx'
import {FailureContent} from '#routes/(home)/-failure.tsx'
import icon from '#routes/icon.svg'
import type {AiProvider} from '#services/ai/schema.ts'
import type {ConnectionInfo} from '#services/connections/schema.ts'

type View = 'ai' | 'servers'
type Search = typeof Search.Type
const Search = Schema.Struct({
	app: Schema.optionalKey(Schema.String),
	bucket: Schema.optionalKey(Schema.Finite),
	metric: Schema.optionalKey(Schema.Literal('tokens')),
	model: Schema.optionalKey(Schema.String),
	period: Schema.optionalKey(Period),
	view: Schema.optionalKey(Schema.Literal('ai'))
})
const route = getRouteApi('/(home)/')

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

function FirstImage(props: {small?: boolean; sources: string[]}) {
	const [failed, setFailed] = useState(0)
	return (
		<span
			className={cn(
				'flex shrink-0 items-center justify-center',
				Boolean.match(props.small === true, {onFalse: () => 'size-5', onTrue: () => 'size-4'})
			)}
		>
			{Option.match(Array.get(props.sources, failed), {
				onNone: () => <HardDrivesIcon className="text-muted-foreground size-4" />,
				onSome: src => (
					<img src={src} alt="" className="size-full object-contain" onError={() => setFailed(failed + 1)} />
				)
			})}
		</span>
	)
}

// Keyed by sources, so icons a later discovery finds get their turn; a dark-background icon goes first without a tile.
function ServerIcon(props: {server: ConnectionInfo; small?: boolean}) {
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
	return <FirstImage key={Array.join(sources, ' ')} small={props.small} sources={sources} />
}

// The page has no detail pane, so a palette pick brings its row into view.
function focusServer(server: ConnectionInfo) {
	const row = document.getElementById(`server-${server.id}`)
	row?.focus()
	row?.scrollIntoView({block: 'center'})
}

function ServerRow(props: {server: ConnectionInfo}) {
	const [confirm, setConfirm] = useState(false)
	const connected = props.server.status === 'Connected'
	return (
		<div role="listitem" className="list-row">
			<RemoveDialog open={confirm} onOpenChange={setConfirm} server={props.server} />
			<ContextMenu>
				<div className="relative flex h-14 min-w-0 items-center gap-3 px-1 max-sm:h-12">
					<ContextMenuTrigger
						render={
							<Button
								variant="ghost"
								id={`server-${props.server.id}`}
								type="button"
								aria-label={`${props.server.name}, ${reasonText(props.server)}`}
								className="absolute inset-0 h-full w-full"
							/>
						}
					/>
					<div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">
						<ServerIcon server={props.server} />
						<span className="max-w-56 min-w-0 shrink truncate text-sm font-medium">{props.server.name}</span>
						<span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
							{new URL(props.server.url).hostname}
						</span>{' '}
						{Array.isReadonlyArrayNonEmpty(props.server.tools) && (
							<span
								className="text-muted-foreground w-8 shrink-0 text-right font-mono text-xs tabular-nums"
								title="Tools"
							>
								{props.server.tools.length}
							</span>
						)}
					</div>
					<div className="relative flex w-16 shrink-0 justify-end">
						{connected && props.server.error === undefined && (
							<span
								role="img"
								title={props.server.status}
								aria-label={props.server.status}
								className="flex size-3 shrink-0 items-center justify-center"
							>
								<Status server={props.server} />
							</span>
						)}
						{(!connected || props.server.error !== undefined) && (
							<Problem
								label={Boolean.match(connected, {
									onFalse: () => reasonText(props.server),
									onTrue: () => 'Connection failed'
								})}
								reset={() => location.assign(connectUrl(props.server.id))}
							/>
						)}
					</div>
				</div>
				<ContextMenuContent className="w-auto min-w-36">
					<ContextMenuItem variant="destructive" className="max-sm:h-11" onClick={() => setConfirm(true)}>
						Remove
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</div>
	)
}

function ServersContent(props: {onAdd: () => void}) {
	const result = useAtomSuspense(serversAtom, {includeFailure: true})
	const refresh = useAtomRefresh(serversAtom)
	const since = Option.getOrUndefined(useAtomValue(problemSinceAtom(serversAtom)))
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return (
		<>
			{Option.getOrUndefined(
				Option.map(value, current =>
					Array.match(Array.sort(current, urgency), {
						onEmpty: () => (
							<EmptyState
								label="No servers yet"
								icon={<HardDrivesIcon className="size-5" weight="light" />}
								action={
									<Button onClick={props.onAdd}>
										<PlusIcon />
										Add server
									</Button>
								}
							/>
						),
						onNonEmpty: servers => (
							<Section title="Servers" meta={`${servers.length} configured`}>
								<div role="list" aria-label="MCP servers">
									{Array.map(servers, server => (
										<ServerRow key={server.id} server={server} />
									))}
								</div>
							</Section>
						)
					})
				)
			)}
			{AsyncResult.isFailure(result) && (
				<div className="bg-background sticky bottom-0 z-20 mt-auto flex shrink-0 justify-end">
					<Problem label="Servers out of date" warning reset={refresh} since={since} />
				</div>
			)}
		</>
	)
}

function ServersPane(props: {onAdd: () => void; servers: readonly ConnectionInfo[]}) {
	return (
		<>
			<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b pb-3">
				<Stat label="Configured" value={props.servers.length} />
				<Stat
					label="Connected"
					value={Array.countBy(props.servers, server => server.status === 'Connected' && server.error === undefined)}
				/>
				<Stat
					label="Need you"
					value={Array.countBy(props.servers, server => server.status !== 'Connected' || server.error !== undefined)}
				/>
			</div>
			<CatchBoundary getResetKey={() => 'servers'} errorComponent={FailureContent}>
				<Suspense fallback={<ItemListSkeleton label="MCP servers" media rows={5} />}>
					<ServersContent onAdd={props.onAdd} />
				</Suspense>
			</CatchBoundary>
		</>
	)
}

function ViewToggle(props: {onView: (view: View) => void; view: View}) {
	return (
		<ToggleGroup
			aria-label="View"
			size="sm"
			spacing={1}
			variant="outline"
			value={[props.view]}
			onValueChange={values =>
				Option.map(Array.head(values), value =>
					props.onView(Boolean.match(value === 'ai', {onFalse: () => 'servers', onTrue: () => 'ai'}))
				)
			}
		>
			<ToggleGroupItem value="servers" aria-label="Servers" className="max-sm:h-11">
				<HardDrivesIcon />
				<span className="max-sm:sr-only">Servers</span>
			</ToggleGroupItem>
			<ToggleGroupItem value="ai" aria-label="AI" className="max-sm:h-11">
				<SparkleIcon />
				<span className="max-sm:sr-only">AI</span>
			</ToggleGroupItem>
		</ToggleGroup>
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
	const search = route.useSearch()
	const navigate = route.useNavigate()
	function show(next: Partial<Search>) {
		navigate({search: previous => ({...previous, ...next})})
	}
	const view = search.view ?? 'servers'
	const period = search.period ?? '7d'
	const metric = search.metric ?? 'cost'
	// The opening count starts each dialog with an empty secret.
	const [keyDialog, setKeyDialog] = useState<{open: boolean; opened: number; provider: AiProvider}>({
		open: false,
		opened: 0,
		provider: PROVIDERS[0]
	})
	const resetKey = useAtomSet(setKeyAtom)
	function addKey(provider: Option.Option<AiProvider>) {
		resetKey(Atom.Reset)
		setKeyDialog(previous => ({
			open: true,
			opened: previous.opened + 1,
			provider: Option.getOrElse(provider, () => PROVIDERS[0])
		}))
	}
	const send = useAtomSet(addAtom.send)
	const copyText = useAtomSet(copyAtom(ENDPOINT))
	const servers = useAtomValue(serversAtom)
	useAtomValue(problemSinceAtom(serversAtom))
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
				icon: <ServerIcon server={server} small />,
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
			icon: <ServerIcon server={server} small />,
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
				onTrue: () => [{icon: <PlusIcon />, label: 'Add server', run: () => send({_tag: 'Open' as const})}]
			}),
			{icon: <KeyIcon />, label: 'Add key', run: () => addKey(Option.none())},
			{icon: <CopyIcon />, label: 'Copy MCP URL', run: () => copyText()}
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
				tabs={
					<ViewToggle
						view={view}
						onView={next =>
							show({
								app: undefined,
								bucket: undefined,
								model: undefined,
								view: Boolean.match(next === 'ai', {onFalse: () => undefined, onTrue: () => 'ai' as const})
							})
						}
					/>
				}
				controls={
					view === 'ai' && (
						<div className="flex items-center gap-2 max-sm:hidden">
							<AiControls
								metric={metric}
								period={period}
								onMetric={next =>
									show({
										metric: Boolean.match(next === 'tokens', {
											onFalse: () => undefined,
											onTrue: () => 'tokens' as const
										})
									})
								}
								onPeriod={next => show({app: undefined, bucket: undefined, model: undefined, period: next})}
							/>
						</div>
					)
				}
			/>
			{view === 'ai' && (
				<div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-1 sm:hidden">
					<AiControls
						metric={metric}
						period={period}
						onMetric={next =>
							show({
								metric: Boolean.match(next === 'tokens', {onFalse: () => undefined, onTrue: () => 'tokens' as const})
							})
						}
						onPeriod={next => show({app: undefined, bucket: undefined, model: undefined, period: next})}
					/>
				</div>
			)}
			<Page width="column">
				<h1 className="sr-only">Gateway</h1>
				{Boolean.match(view === 'ai', {
					onFalse: () => <ServersPane onAdd={() => send({_tag: 'Open'})} servers={sorted} />,
					onTrue: () => (
						<AiPane
							focus={{app: search.app, bucket: search.bucket, model: search.model}}
							metric={metric}
							onAdd={addKey}
							onFocus={focus => show({app: focus.app, bucket: focus.bucket, model: focus.model})}
							period={period}
						/>
					)
				})}
			</Page>
			<AddDialog />
			<AddKeyDialog
				key={keyDialog.opened}
				open={keyDialog.open}
				provider={keyDialog.provider}
				onProvider={provider => setKeyDialog(previous => ({...previous, provider}))}
				onOpenChange={open => setKeyDialog(previous => ({...previous, open}))}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
