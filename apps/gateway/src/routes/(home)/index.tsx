import {useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Number, Option, Order, Schema, String, type Record} from 'effect'

import {CheckIcon, CopyIcon, HardDrivesIcon, KeyIcon, LinkIcon, WrenchIcon} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {ItemListHeading} from '@deslop/components-web/item-list'
import {Page} from '@deslop/components-web/page'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Field, FieldError} from '@deslop/components-web/ui/field'
import {InputGroup, InputGroupAddon, InputGroupInput} from '@deslop/components-web/ui/input-group'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Tabs, TabsList, TabsTrigger} from '@deslop/components-web/ui/tabs'
import {cn} from '@deslop/components-web/utils'
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
	mcpUsageAtom,
	Period,
	serversAtom,
	setKeyAtom
} from '#lib/utils.ts'
import {FailureContent} from '#routes/(home)/-failure.tsx'
import {AddKeyDialog, PROVIDER_NAMES, PROVIDERS, ProviderMark, providerOfKey} from '#routes/(home)/-keys.tsx'
import {providerCost, providerSeries, serverCalls, serverSeries, type Range} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import type {AiKeyInfo, AiProvider, AiUsageReport} from '#services/ai/schema.ts'
import type {ConnectionInfo, McpUsageServer} from '#services/connections/schema.ts'

const PERIODS = [
	{label: '24h', value: '24h'},
	{label: '7d', value: '7d'},
	{label: '30d', value: '30d'}
] satisfies {label: string; value: Period}[]
// Each app's identity hue; a server without one of these marks stays zinc grey.
const IDENTITY_HUES: Record<string, string> = {
	auth: 'var(--slate)',
	deploy: 'var(--blue)',
	gateway: 'var(--pink)',
	opm: 'var(--ivory)',
	portfolio: 'var(--coral)',
	scope: 'var(--cyan)',
	stash: 'var(--amber)',
	trips: 'var(--orange)'
}

type Search = typeof Search.Type
// The period is the page's only view state; the default is the last week.
const Search = Schema.Struct({period: Schema.optionalKey(Period)})
const route = getRouteApi('/(home)/')

// Every app's canonical mark by its folder; Gateway's own mark joins by name.
const APP_ICONS: Record<string, string> = {
	...WebRuntime.appIcons(
		import.meta.glob<string>('../../../../*/src/routes/icon.svg', {eager: true, import: 'default', query: '?url'})
	),
	gateway: icon
}
const count = new Intl.NumberFormat('en')
const appKey = String.toLowerCase

function serverHue(server: ConnectionInfo) {
	const key = appKey(server.id)
	if (APP_ICONS[key] === undefined) return 'var(--muted-foreground)'
	return IDENTITY_HUES[key] ?? 'var(--muted-foreground)'
}
function urgency(server: ConnectionInfo) {
	if (server.error !== undefined || server.status === 'Expired') return 0
	if (server.status === 'Not connected') return 1
	return 2
}
const byUrgency = Order.mapInput(Order.Number, urgency)

// A 64×14 line of the period's figures in the row's own hue; zeros rest on the baseline.
function Sparkline(props: {color: string; values: readonly number[]}) {
	const high = Array.reduce(props.values, 0, (maximum, value) => Number.max(maximum, value))
	const points = Array.map(props.values, (value, index) => {
		const x = (index / Number.max(1, props.values.length - 1)) * 64
		const y = Boolean.match(high === 0, {onFalse: () => 13 - (value / high) * 12, onTrue: () => 13})
		return `${x.toFixed(1)} ${y.toFixed(1)}`
	})
	return (
		<svg aria-hidden className="h-3.5 w-16 shrink-0" fill="none" viewBox="0 0 64 14">
			<path
				d={`M${Array.join(points, ' L')}`}
				stroke={props.color}
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	)
}

// A loading row's block, without the app's shared skeleton's pulse: Gateway animates nothing.
function Bone(props: {className: string}) {
	return <div aria-hidden className={cn('bg-muted', props.className)} />
}

// The rows a group will hold, at their own row and column geometry; only a server row has a tool count.
function RowsSkeleton(props: {label: string; rows: number; tool?: boolean}) {
	return (
		<div aria-busy="true" aria-label={props.label} role="status">
			{Array.map(Array.range(1, props.rows), row => (
				<Item key={row} aria-hidden size="row">
					<ItemMedia>
						<Bone className="size-5" />
					</ItemMedia>
					<ItemContent>
						<Bone className="h-3 w-24" />
						<Bone className="h-3 w-16" />
					</ItemContent>
					<ItemActions>
						{props.tool === true && <Bone className="h-3.5 w-7" />}
						<Bone className="h-3.5 w-16" />
						<Bone className="h-3 w-12" />
					</ItemActions>
				</Item>
			))}
		</div>
	)
}

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

// One server: its mark, name and host, what it offers or the button that connects it, then its calls over the period.
function ServerRow(props: {period: Range; report: readonly McpUsageServer[]; server: ConnectionInfo}) {
	const [connecting, setConnecting] = useState(false)
	const connected = props.server.status === 'Connected'
	const needsUser = !connected || props.server.error !== undefined
	const failed = props.server.status === 'Expired' || props.server.error !== undefined
	const action = Boolean.match(connected, {onFalse: () => 'Connect' as const, onTrue: () => 'Reconnect' as const})
	function connect() {
		setConnecting(true)
		location.assign(connectUrl(props.server.id))
	}
	return (
		<div role="listitem">
			<Item size="row">
				<ItemMedia>
					<ServerIcon server={props.server} />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{props.server.name}</ItemTitle>
					<ItemDescription>{new URL(props.server.url).hostname}</ItemDescription>
				</ItemContent>
				<ItemActions>
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
						onTrue: () => (
							<Button
								size="xs"
								className="max-sm:h-11"
								disabled={connecting}
								aria-label={`${action} ${props.server.name}`}
								onClick={connect}
							>
								{action}
							</Button>
						)
					})}
					<Sparkline
						color={serverHue(props.server)}
						values={serverSeries(props.report, props.server.id, props.period)}
					/>
					<span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">
						{count.format(serverCalls(props.report, props.server.id))}
					</span>
				</ItemActions>
			</Item>
		</div>
	)
}

function ServerUsage(props: {period: Period; servers: readonly ConnectionInfo[]}) {
	const result = useAtomSuspense(mcpUsageAtom(props.period), {includeFailure: true})
	const refresh = useAtomRefresh(mcpUsageAtom(props.period))
	if (
		AsyncResult.isFailure(result) &&
		(Option.isNone(AsyncResult.value(result)) || Option.exists(AsyncResult.error(result), isDenied))
	) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return Option.getOrUndefined(
		Option.map(AsyncResult.value(result), current =>
			Array.map(props.servers, server => (
				<ServerRow key={server.id} server={server} period={current.range} report={current.report} />
			))
		)
	)
}

// The servers reader first, so a refusal or a failed read shows without waiting for usage.
function ServerRows(props: {period: Period}) {
	const result = useAtomSuspense(serversAtom, {includeFailure: true})
	const refresh = useAtomRefresh(serversAtom)
	if (
		AsyncResult.isFailure(result) &&
		(Option.isNone(AsyncResult.value(result)) || Option.exists(AsyncResult.error(result), isDenied))
	) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	const servers = Option.getOrElse(AsyncResult.value(result), () => [])
	if (Array.isReadonlyArrayEmpty(servers)) return null
	const ordered = Array.sort(servers, byUrgency)
	return (
		<Suspense fallback={<RowsSkeleton label="MCP servers" rows={ordered.length} tool />}>
			<ServerUsage period={props.period} servers={ordered} />
		</Suspense>
	)
}

// One key: its provider's mark and name, the secret's last four, then its cost over the period.
function KeyRow(props: {cost: string; info: AiKeyInfo; period: Range; provider: AiProvider; report: AiUsageReport}) {
	return (
		<div role="listitem">
			<Item size="row">
				<ItemMedia>
					<span className="flex size-5 items-center justify-center">
						<ProviderMark provider={props.provider} />
					</span>
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{PROVIDER_NAMES[props.provider]}</ItemTitle>
					<ItemDescription>{`…${props.info.last4}`}</ItemDescription>
				</ItemContent>
				<ItemActions>
					{(props.info.lastStatus === 401 || props.info.lastStatus === 403) && <StatusDot status="error" />}
					<Sparkline color="var(--primary)" values={providerSeries(props.report, props.provider, props.period)} />
					<span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{props.cost}</span>
				</ItemActions>
			</Item>
		</div>
	)
}

function KeyUsage(props: {keys: readonly AiKeyInfo[]; period: Period}) {
	const result = useAtomSuspense(aiUsageAtom(props.period), {includeFailure: true})
	const refresh = useAtomRefresh(aiUsageAtom(props.period))
	if (
		AsyncResult.isFailure(result) &&
		(Option.isNone(AsyncResult.value(result)) || Option.exists(AsyncResult.error(result), isDenied))
	) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	return Option.getOrUndefined(
		Option.map(AsyncResult.value(result), current =>
			Array.flatMap(PROVIDERS, provider =>
				Option.match(
					Array.findFirst(props.keys, key => key.provider === provider),
					{
						onNone: () => [],
						onSome: info => [
							<KeyRow
								key={provider}
								provider={provider}
								info={info}
								report={current.report}
								period={current.range}
								cost={providerCost(current.report, provider)}
							/>
						]
					}
				)
			)
		)
	)
}

// Only providers with a key have a row; the field adds and replaces them.
function KeyRows(props: {period: Period}) {
	const result = useAtomSuspense(aiKeysAtom, {includeFailure: true})
	const refresh = useAtomRefresh(aiKeysAtom)
	if (
		AsyncResult.isFailure(result) &&
		(Option.isNone(AsyncResult.value(result)) || Option.exists(AsyncResult.error(result), isDenied))
	) {
		return <FailureContent error={Cause.squash(result.cause)} reset={refresh} />
	}
	const keys = Array.filter(
		Option.getOrElse(AsyncResult.value(result), () => []),
		key => Array.contains(PROVIDERS, key.provider)
	)
	if (Array.isReadonlyArrayEmpty(keys)) return null
	return (
		<Suspense fallback={<RowsSkeleton label="AI keys" rows={keys.length} />}>
			<KeyUsage keys={keys} period={props.period} />
		</Suspense>
	)
}

// Each group is read on its own, so one failing reader leaves the other group's rows.
function List(props: {period: Period}) {
	return (
		<Card size="list">
			<div role="list" aria-label="MCP servers and AI keys">
				<ItemListHeading icon={<HardDrivesIcon />}>Servers</ItemListHeading>
				<CatchBoundary getResetKey={() => 'servers'} errorComponent={FailureContent}>
					<Suspense fallback={<RowsSkeleton label="MCP servers" rows={3} tool />}>
						<ServerRows period={props.period} />
					</Suspense>
				</CatchBoundary>
				<ItemListHeading icon={<KeyIcon />}>Keys</ItemListHeading>
				<CatchBoundary getResetKey={() => 'keys'} errorComponent={FailureContent}>
					<Suspense fallback={<RowsSkeleton label="AI keys" rows={4} />}>
						<KeyRows period={props.period} />
					</Suspense>
				</CatchBoundary>
			</div>
		</Card>
	)
}

// The field adds a server URL through the existing flow, or opens the key flow with a pasted key.
function AddField(props: {onKey: (provider: AiProvider, secret: string) => void}) {
	const send = useAtomSet(addAtom.send)
	const editing = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(addAtom, 'Editing')), Option.none)
	const adding = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(addAtom, 'Adding')), Option.none)
	const typed = Option.getOrElse(
		Option.map(editing, state => state.url),
		() =>
			Option.getOrElse(
				Option.map(adding, state => state.url),
				() => ''
			)
	)
	const error = Option.getOrElse(
		Option.map(editing, state => state.error),
		() => ''
	)
	const busy = Option.isSome(adding)
	function submit() {
		const value = String.trim(typed)
		if (value === '' || busy) return
		if (String.startsWith('sk-')(value)) {
			props.onKey(providerOfKey(value), value)
			send({_tag: 'Typed', url: ''})
			return
		}
		send({_tag: 'Submit'})
	}
	return (
		<form
			onSubmit={event => {
				event.preventDefault()
				submit()
			}}
		>
			<Field data-invalid={error !== ''}>
				<InputGroup className="h-9 max-sm:h-11">
					<InputGroupAddon className="max-sm:hidden">
						<LinkIcon />
					</InputGroupAddon>
					<InputGroupInput
						className="max-sm:h-11"
						aria-label="MCP server URL or provider key"
						aria-invalid={error !== ''}
						aria-describedby="gateway-add-error"
						placeholder="Paste an MCP server URL or a provider key"
						autoComplete="off"
						spellCheck={false}
						value={typed}
						disabled={busy}
						onChange={event => send({_tag: 'Typed', url: event.target.value})}
					/>
				</InputGroup>
				{error !== '' && <FieldError id="gateway-add-error">{error}</FieldError>}
			</Field>
		</form>
	)
}

function PeriodTabs(props: {onPeriod: (period: Period) => void; period: Period}) {
	return (
		<Tabs
			value={props.period}
			onValueChange={value =>
				Option.map(
					Array.findFirst(PERIODS, entry => entry.value === value),
					entry => props.onPeriod(entry.value)
				)
			}
		>
			<TabsList aria-label="Period">
				{Array.map(PERIODS, entry => (
					<TabsTrigger key={entry.value} value={entry.value}>
						{entry.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
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

// Staleness shows once, as the oldest stale reader; one retry refreshes them all.
function GatewayProblem(props: {period: Period}) {
	const serversSince = useAtomValue(problemSinceAtom(serversAtom))
	const usageSince = useAtomValue(problemSinceAtom(mcpUsageAtom(props.period)))
	const keysSince = useAtomValue(problemSinceAtom(aiKeysAtom))
	const aiSince = useAtomValue(problemSinceAtom(aiUsageAtom(props.period)))
	const refreshServers = useAtomRefresh(serversAtom)
	const refreshUsage = useAtomRefresh(mcpUsageAtom(props.period))
	const refreshKeys = useAtomRefresh(aiKeysAtom)
	const refreshAi = useAtomRefresh(aiUsageAtom(props.period))
	return Option.match(
		Array.reduce(
			Array.flatMap([serversSince, usageSince, keysSince, aiSince], Option.toArray),
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
						refreshAi()
					}}
				/>
			)
		}
	)
}

function Home() {
	const search = route.useSearch()
	const navigate = route.useNavigate()
	const period = search.period ?? '7d'
	// Open, which opening it is (so each starts with the pasted secret), and the provider it adds.
	const [keyDialog, setKeyDialog] = useState<{open: boolean; opened: number; provider: AiProvider; secret: string}>({
		open: false,
		opened: 0,
		provider: PROVIDERS[0],
		secret: ''
	})
	const resetKey = useAtomSet(setKeyAtom)
	function addKey(provider: AiProvider, secret: string) {
		resetKey(Atom.Reset)
		setKeyDialog(previous => ({open: true, opened: previous.opened + 1, provider, secret}))
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="gateway"
				controls={
					<>
						<GatewayProblem period={period} />
						<PeriodTabs
							period={period}
							onPeriod={next => navigate({search: previous => ({...previous, period: next})})}
						/>
						<CopyEndpoint />
					</>
				}
			/>
			<Page width="column">
				<h1 className="sr-only">Gateway</h1>
				<AddField onKey={addKey} />
				<List period={period} />
			</Page>
			<AddKeyDialog
				key={keyDialog.opened}
				open={keyDialog.open}
				provider={keyDialog.provider}
				secret={keyDialog.secret}
				onProvider={provider => setKeyDialog(previous => ({...previous, provider}))}
				onOpenChange={open => setKeyDialog(previous => ({...previous, open}))}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home, validateSearch: WebRuntime.searchOf(Search)})
