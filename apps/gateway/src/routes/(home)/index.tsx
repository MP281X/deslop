import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Match, Number, Option, Order, Schema, String, pipe} from 'effect'

import {CheckIcon, CopyIcon, HardDrivesIcon, PlusIcon, WrenchIcon} from '@phosphor-icons/react'
import {CatchBoundary, Link, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Page} from '@deslop/components-web/page'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle} from '@deslop/components-web/ui/dialog'
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {UndoButton} from '@deslop/components-web/undo'
import {isDenied} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {
	addAtom,
	aiKeysAtom,
	aiUsageAtom,
	connectUrl,
	copiedAtom,
	copyAtom,
	ENDPOINT,
	Period,
	removeServerAtom,
	serversAtom,
	setKeyAtom
} from '#lib/utils.ts'
import {AddKeyDialog, AiControls, AiPane, PROVIDERS} from '#routes/(home)/-ai.tsx'
import {FailureContent} from '#routes/(home)/-failure.tsx'
import icon from '#routes/icon.svg'
import type {AiProvider} from '#services/ai/schema.ts'
import type {ConnectionInfo} from '#services/connections/schema.ts'

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

// A server's own words for why it needs the user, or its host when it is fine.
function reasonText(server: ConnectionInfo) {
	if (server.error !== undefined) return 'Connection failed'
	return pipe(
		Match.value(server.status),
		Match.when('Expired', () => 'Sign-in expired'),
		Match.when('Not connected', () => 'Not connected'),
		Match.orElse(() => new URL(server.url).hostname)
	)
}

// Each source in turn until one loads, drawn as the server ships it, without a tile behind it.
function FirstImage(props: {sources: string[]}) {
	const [failed, setFailed] = useState(0)
	return (
		<span className="flex size-5 shrink-0 items-center justify-center">
			{Option.match(Array.get(props.sources, failed), {
				onNone: () => <HardDrivesIcon className="text-muted-foreground size-4" />,
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

// One row per server: its icon, name and host on one line, then its tool count or the button that reconnects it; its context menu removes it.
function ServerRow(props: {
	failure: Option.Option<string>
	onRemove: () => void
	onSelect: () => void
	removed: boolean
	selected: boolean
	server: ConnectionInfo
	undo: () => void
}) {
	const connected = props.server.status === 'Connected'
	const needsUser = !connected || props.server.error !== undefined
	const failed = props.server.status === 'Expired' || props.server.error !== undefined
	function connect() {
		location.assign(connectUrl(props.server.id))
	}
	return (
		<div role="listitem" className="relative">
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<Item
							size="row"
							id={`server-${props.server.id}`}
							tabIndex={0}
							data-removed={props.removed}
							data-selected={props.selected}
							aria-label={`${props.server.name}, ${reasonText(props.server)}`}
							onFocus={props.onSelect}
							render={Boolean.match(needsUser, {
								onFalse: () => <div />,
								onTrue: () => <button type="button" aria-label={`${props.server.name}, ${reasonText(props.server)}`} />
							})}
							{...Boolean.match(needsUser, {onFalse: () => ({}), onTrue: () => ({onClick: connect})})}
						/>
					}
				>
					<ItemMedia>
						<ServerIcon server={props.server} />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{props.server.name}</ItemTitle>
						<ItemDescription>
							{Option.getOrElse(props.failure, () => new URL(props.server.url).hostname)}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						{Boolean.match(props.removed, {
							onFalse: () => (
								<>
									{failed && <StatusDot status="error" />}
									{Boolean.match(needsUser, {
										onFalse: () =>
											Array.isReadonlyArrayNonEmpty(props.server.tools) && (
												<span
													className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs tabular-nums"
													title="Tools"
												>
													{props.server.tools.length}
													<WrenchIcon className="size-3.5" />
												</span>
											),
										onTrue: () => <span className="w-20" />
									})}
								</>
							),
							onTrue: () => <UndoButton onClick={props.undo} />
						})}
					</ItemActions>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-auto min-w-36">
					<ContextMenuItem variant="destructive" className="max-sm:h-11" onClick={props.onRemove}>
						Remove
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			{needsUser && !props.removed && (
				<Button size="xs" className="absolute top-1/2 right-4 -translate-y-1/2" onClick={connect}>
					{Boolean.match(connected, {onFalse: () => 'Connect', onTrue: () => 'Reconnect'})}
				</Button>
			)}
		</div>
	)
}

function ServersContent(props: {
	onAdd: () => void
	onSelect: (server: ConnectionInfo) => void
	selected: Option.Option<string>
}) {
	const result = useAtomSuspense(serversAtom, {includeFailure: true})
	const refresh = useAtomRefresh(serversAtom)
	const send = useAtomSet(removeServerAtom.send)
	const waiting = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(removeServerAtom, 'Waiting')), Option.none)
	const failed = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(removeServerAtom, 'Failed')), Option.none)
	const value = AsyncResult.value(result)
	if (AsyncResult.isFailure(result) && (Option.isNone(value) || Option.exists(AsyncResult.error(result), isDenied))) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return Option.getOrUndefined(
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
					<Card size="list">
						<div role="list" aria-label="MCP servers">
							{Array.map(servers, server => (
								<ServerRow
									key={server.id}
									server={server}
									failure={Option.map(
										Option.filter(failed, state => state.id === server.id),
										state => state.message
									)}
									removed={Option.exists(waiting, state => state.id === server.id)}
									selected={Option.contains(props.selected, server.id)}
									onSelect={() => props.onSelect(server)}
									undo={() => send({_tag: 'Undone'})}
									onRemove={() => {
										send({_tag: 'Dismissed'})
										send({_tag: 'Removed', id: server.id})
									}}
								/>
							))}
						</div>
					</Card>
				)
			})
		)
	)
}

function ServersPane(props: {
	onAdd: () => void
	onSelect: (server: ConnectionInfo) => void
	selected: Option.Option<string>
}) {
	return (
		<CatchBoundary getResetKey={() => 'servers'} errorComponent={FailureContent}>
			<Suspense
				fallback={
					<Card>
						<ItemListSkeleton label="MCP servers" media rows={5} />
					</Card>
				}
			>
				<ServersContent onAdd={props.onAdd} onSelect={props.onSelect} selected={props.selected} />
			</Suspense>
		</CatchBoundary>
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

function ServersProblem() {
	const since = useAtomValue(problemSinceAtom(serversAtom))
	const refresh = useAtomRefresh(serversAtom)
	return Option.match(since, {
		onNone: () => null,
		onSome: value => <Problem label="Out of date" warning reset={refresh} since={value} />
	})
}

function AiProblem(props: {period: Period}) {
	const serversSince = useAtomValue(problemSinceAtom(serversAtom))
	const usageSince = useAtomValue(problemSinceAtom(aiUsageAtom(props.period)))
	const keysSince = useAtomValue(problemSinceAtom(aiKeysAtom))
	const refreshServers = useAtomRefresh(serversAtom)
	const refreshUsage = useAtomRefresh(aiUsageAtom(props.period))
	const refreshKeys = useAtomRefresh(aiKeysAtom)
	return Option.match(
		Array.reduce(
			Array.flatMap([serversSince, usageSince, keysSince], Option.toArray),
			Option.none<number>(),
			(oldest, value) =>
				Option.some(Option.match(oldest, {onNone: () => value, onSome: current => Number.min(current, value)}))
		),
		{
			onNone: () => null,
			onSome: value => (
				<Problem
					label="Out of date"
					warning
					since={value}
					reset={() => {
						refreshServers()
						refreshUsage()
						refreshKeys()
					}}
				/>
			)
		}
	)
}

// Copies the gateway's MCP URL; the button shows a check for a moment after a copy.
function CopyEndpoint() {
	const copy = useAtomSet(copyAtom(ENDPOINT))
	const copied = useAtomValue(copiedAtom)
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			className="max-sm:size-11"
			aria-label={Boolean.match(copied, {onFalse: () => 'Copy MCP URL', onTrue: () => 'Copied'})}
			onClick={() => copy()}
		>
			{Boolean.match(copied, {onFalse: () => <CopyIcon />, onTrue: () => <CheckIcon />})}
		</Button>
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
	const [selected, setSelected] = useState<Option.Option<string>>(() => Option.none())
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
	// Switching view clears the narrowing; the period and measure carry over.
	const clear = {app: undefined, bucket: undefined, model: undefined, view: undefined}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="gateway"
				tabs={
					<AppBarTabs value={view}>
						<AppBarTab value="servers" render={<Link to="/" search={{...search, ...clear}} />}>
							Servers
						</AppBarTab>
						<AppBarTab value="ai" render={<Link to="/" search={{...search, ...clear, view: 'ai'}} />}>
							AI
						</AppBarTab>
					</AppBarTabs>
				}
				controls={
					<>
						{Boolean.match(view === 'ai', {
							onFalse: () => <ServersProblem />,
							onTrue: () => <AiProblem period={period} />
						})}
						{view === 'servers' && (
							<>
								<Button
									variant="ghost"
									size="icon-sm"
									className="max-sm:size-11"
									aria-label="Add server"
									onClick={() => send({_tag: 'Open'})}
								>
									<PlusIcon />
								</Button>
								<CopyEndpoint />
							</>
						)}
						{view === 'ai' && (
							<AiControls
								period={period}
								onPeriod={next => show({app: undefined, bucket: undefined, model: undefined, period: next})}
							/>
						)}
					</>
				}
			/>
			<Page width="column">
				<h1 className="sr-only">Gateway</h1>
				{Boolean.match(view === 'ai', {
					onFalse: () => (
						<ServersPane
							onAdd={() => send({_tag: 'Open'})}
							onSelect={server => setSelected(Option.some(server.id))}
							selected={selected}
						/>
					),
					onTrue: () => (
						<AiPane
							focus={{app: search.app, bucket: search.bucket, model: search.model}}
							metric={metric}
							onAdd={addKey}
							onFocus={focus => show({app: focus.app, bucket: focus.bucket, model: focus.model})}
							onMetric={next =>
								show({
									metric: Boolean.match(next === 'tokens', {onFalse: () => undefined, onTrue: () => 'tokens' as const})
								})
							}
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
