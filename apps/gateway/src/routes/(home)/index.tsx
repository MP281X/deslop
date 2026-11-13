import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Number, Option, Order, Schema, String, pipe} from 'effect'

import {CheckIcon, CopyIcon, HardDrivesIcon, LinkIcon, WrenchIcon} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {AppBar, AppBarChoice} from '@deslop/components-web/app-bar'
import {APP_HUES, appMarks} from '@deslop/components-web/apps'
import {Loaded, ReadFailure} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {Page} from '@deslop/components-web/page'
import {StaleProblem} from '@deslop/components-web/problem'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Field, FieldError} from '@deslop/components-web/ui/field'
import {InputGroup, InputGroupAddon, InputGroupInput} from '@deslop/components-web/ui/input-group'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {
	addAtom,
	aiKeysAtom,
	aiUsageAtom,
	connectAtom,
	copiedAtom,
	copyAtom,
	mcpUsageAtom,
	serversAtom,
	setKeyAtom
} from '#lib/gateway.ts'
import {Search} from '#lib/search.ts'
import {AddKeyDialog, PROVIDERS, ProviderMark, providerOfKey} from '#routes/(home)/-keys.tsx'
import {providerCost, providerSeries, serverSeries} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import type {AiUsageReport} from '#services/ai-metering/schema.ts'
import {PROVIDER_NAMES} from '#services/ai-proxy/schema.ts'
import type {AiKeyItem, AiProvider} from '#services/ai-proxy/schema.ts'
import type {ConnectionItem, McpUsageServer} from '#services/connections/schema.ts'
import {Period} from '#services/usage/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

const PERIODS = Array.map(Period.literals, value => ({label: value, value}))

const route = getRouteApi('/(home)/')

const count = new Intl.NumberFormat('en')

function serverHue(server: ConnectionItem) {
	const key = String.toLowerCase(server.id)
	if (appMarks[key] === undefined) return 'var(--muted-foreground)'
	return APP_HUES[key] ?? 'var(--muted-foreground)'
}
function urgency(server: ConnectionItem) {
	if (Option.isSome(server.error) || server.status === 'Expired') return 0
	if (server.status === 'Not connected') return 1
	return 2
}
const byUrgency = Order.mapInput(Order.Number, urgency)

// A 64×14 line of the period's figures in the row's own hue; zeros rest on the baseline.
function Sparkline(props: {color: string; values: readonly number[]}) {
	const high = Array.match(props.values, {onEmpty: () => 0, onNonEmpty: values => Array.max(values, Order.Number)})
	const points = Array.map(props.values, (value, index) => {
		const x = (index / Number.max(1, props.values.length - 1)) * 64
		const y = Boolean.match(high === 0, {onFalse: () => 13 - (value / high) * 12, onTrue: () => 13})
		return `${x.toFixed(1)} ${y.toFixed(1)}`
	})
	return (
		<svg aria-hidden className="h-3.5 w-16 shrink-0 max-sm:hidden" fill="none" viewBox="0 0 64 14">
			<path
				d={`M${Array.join(points, ' L')}`}
				stroke={props.color}
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	)
}

// A loading row's blocks at its own row and column geometry; only a server row has a tool count.
function RowBones(props: {tool?: boolean}) {
	return (
		<>
			<ItemMedia>
				<Skeleton className="size-4" />
			</ItemMedia>
			<ItemContent>
				<Skeleton className="h-3 w-24" />
				<Skeleton className="h-3 w-16" />
			</ItemContent>
			<ItemActions>
				{props.tool === true && <Skeleton className="h-3.5 w-7" />}
				<Skeleton className="h-3.5 w-16 max-sm:hidden" />
				<Skeleton className="h-3 w-12" />
			</ItemActions>
		</>
	)
}

function FirstImage(props: {sources: string[]}) {
	const [failed, setFailed] = useState(0)
	return (
		<span className="flex size-4 shrink-0 items-center justify-center">
			{pipe(
				props.sources,
				Array.get(failed),
				Option.match({
					onNone: () => <HardDrivesIcon className="text-muted-foreground size-4" />,
					onSome: src => (
						<img src={src} alt="" className="size-full object-contain" onError={() => setFailed(failed + 1)} />
					)
				})
			)}
		</span>
	)
}

// Keyed by its sources, so icons a later discovery finds get their turn. Without a tile behind it, an icon drawn for dark backgrounds goes first.
function ServerIcon(props: {server: ConnectionItem}) {
	const host = new URL(props.server.url).hostname
	const sources = Array.dedupe([
		...pipe(
			props.server.icons,
			Array.sort(
				Order.mapInput(Order.Boolean, (entry: ConnectionItem['icons'][number]) => !Option.contains(entry.theme, 'dark'))
			),
			Array.map(entry => entry.src)
		),
		`https://${host}/favicon.ico`,
		`https://${String.replace(/^(?:api|app|mcp)\./u, '')(host)}/favicon.ico`
	])
	return <FirstImage key={Array.join(sources, ' ')} sources={sources} />
}

// One server: its mark, name and host, what it offers or the button that connects it, then its calls over the period.
function ServerRow(props: {period: UsageRange; report: readonly McpUsageServer[]; server: ConnectionItem}) {
	const [connecting, connect] = useAtom(connectAtom(props.server.id))
	const connected = props.server.status === 'Connected'
	const needsUser = !connected || Option.isSome(props.server.error)
	const failed = props.server.status === 'Expired' || Option.isSome(props.server.error)
	const action = Boolean.match(connected, {onFalse: () => 'Connect' as const, onTrue: () => 'Reconnect' as const})
	const series = serverSeries(props.report, props.server.id, props.period)
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
							props.server.tools > 0 && (
								<span
									className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs tabular-nums"
									title="Tools"
								>
									{props.server.tools}
									<WrenchIcon className="size-3.5" />
								</span>
							),
						onTrue: () => (
							<Button
								size="xs"
								className="max-sm:h-11"
								disabled={AsyncResult.isWaiting(connecting)}
								aria-label={`${action} ${props.server.name}`}
								onClick={() => connect()}
							>
								{action}
							</Button>
						)
					})}
					<Sparkline color={serverHue(props.server)} values={series} />
					<span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">
						{count.format(Number.sumAll(series))}
					</span>
				</ItemActions>
			</Item>
		</div>
	)
}

// The servers reader first, so a refusal or a failed read shows without waiting for usage.
function ServerRows(props: {period: Period}) {
	return (
		<Loaded atom={serversAtom}>
			{servers =>
				pipe(
					servers,
					Array.sort(byUrgency),
					Array.match({
						onEmpty: () => null,
						onNonEmpty: ordered => (
							<Suspense
								fallback={
									<RowsSkeleton label="MCP servers" rows={ordered.length}>
										<RowBones tool />
									</RowsSkeleton>
								}
							>
								<Loaded atom={mcpUsageAtom(props.period)}>
									{current =>
										Array.map(ordered, server => (
											<ServerRow key={server.id} server={server} period={current.range} report={current.report} />
										))
									}
								</Loaded>
							</Suspense>
						)
					})
				)
			}
		</Loaded>
	)
}

// One key: its provider's mark and name, the secret's last four, then its cost over the period.
function KeyRow(props: {
	cost: string
	info: AiKeyItem
	period: UsageRange
	provider: AiProvider
	report: AiUsageReport
}) {
	return (
		<div role="listitem">
			<Item size="row">
				<ItemMedia>
					<span className="flex size-4 items-center justify-center">
						<ProviderMark provider={props.provider} />
					</span>
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{PROVIDER_NAMES[props.provider]}</ItemTitle>
					<ItemDescription>{`…${props.info.last4}`}</ItemDescription>
				</ItemContent>
				<ItemActions>
					{Option.exists(props.info.lastStatus, status => status === 401 || status === 403) && (
						<StatusDot status="error" />
					)}
					<Sparkline color="var(--primary)" values={providerSeries(props.report, props.provider, props.period)} />
					<span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{props.cost}</span>
				</ItemActions>
			</Item>
		</div>
	)
}

function KeyUsage(props: {keys: readonly AiKeyItem[]; period: Period}) {
	const keysByProvider = Array.groupBy(props.keys, key => key.provider)
	return (
		<Loaded atom={aiUsageAtom(props.period)}>
			{current =>
				Array.flatMap(PROVIDERS, provider =>
					pipe(
						Option.fromUndefinedOr(keysByProvider[provider]),
						Option.map(Array.headNonEmpty),
						Option.match({
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
						})
					)
				)
			}
		</Loaded>
	)
}

// Only providers with a key have a row; the field adds and replaces them.
function KeyRows(props: {period: Period}) {
	return (
		<Loaded atom={aiKeysAtom}>
			{all =>
				Array.match(all, {
					onEmpty: () => null,
					onNonEmpty: keys => (
						<Suspense
							fallback={
								<RowsSkeleton label="AI keys" rows={keys.length}>
									<RowBones />
								</RowsSkeleton>
							}
						>
							<KeyUsage keys={keys} period={props.period} />
						</Suspense>
					)
				})
			}
		</Loaded>
	)
}

// Each group is read on its own, so one failing reader leaves the other group's rows.
function List(props: {period: Period}) {
	return (
		<Card size="list">
			<div role="list" aria-label="MCP servers and AI keys">
				<CatchBoundary getResetKey={() => 'servers'} errorComponent={ReadFailure}>
					<Suspense
						fallback={
							<RowsSkeleton label="MCP servers" rows={3}>
								<RowBones tool />
							</RowsSkeleton>
						}
					>
						<ServerRows period={props.period} />
					</Suspense>
				</CatchBoundary>
				<CatchBoundary getResetKey={() => 'keys'} errorComponent={ReadFailure}>
					<Suspense
						fallback={
							<RowsSkeleton label="AI keys" rows={4}>
								<RowBones />
							</RowsSkeleton>
						}
					>
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
	const editing = pipe(useMachineResult(AtomMachine.select(addAtom, 'Editing')), AsyncResult.value, Option.flatten)
	const adding = pipe(useMachineResult(AtomMachine.select(addAtom, 'Adding')), AsyncResult.value, Option.flatten)
	const typed = pipe(
		editing,
		Option.map(state => state.url),
		Option.getOrElse(() =>
			pipe(
				adding,
				Option.map(state => state.url),
				Option.getOrElse(() => '')
			)
		)
	)
	const error = Option.flatMap(editing, state => state.error)
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
			<Field data-invalid={Option.isSome(error)}>
				<InputGroup className="h-9 max-sm:h-11">
					<InputGroupAddon className="max-sm:hidden">
						<LinkIcon />
					</InputGroupAddon>
					<InputGroupInput
						className="max-sm:h-11"
						aria-label="MCP server URL or provider key"
						aria-invalid={Option.isSome(error)}
						aria-describedby="gateway-add-error"
						placeholder="Paste an MCP URL or a key"
						autoComplete="off"
						spellCheck={false}
						value={typed}
						disabled={busy}
						onChange={event => send({_tag: 'Typed', url: event.target.value})}
					/>
				</InputGroup>
				{Option.match(error, {
					onNone: () => null,
					onSome: message => <FieldError id="gateway-add-error">{message}</FieldError>
				})}
			</Field>
		</form>
	)
}

function PeriodTabs(props: {onPeriod: (period: Period) => void; period: Period}) {
	return (
		<AppBarChoice
			label="Period"
			options={PERIODS}
			value={props.period}
			onChange={value =>
				pipe(
					PERIODS,
					Array.findFirst(entry => entry.value === value),
					Option.map(entry => props.onPeriod(entry.value))
				)
			}
		/>
	)
}

// Copies the gateway's MCP URL; the button shows a check for a moment after a copy and turns destructive when it fails.
function CopyEndpoint() {
	const [result, copy] = useAtom(copyAtom(`${window.location.origin}/mcp`))
	const copied = useAtomValue(copiedAtom)
	// A retry in flight is no longer the failure it follows.
	const failed = AsyncResult.isFailure(result) && !result.waiting
	return (
		<Button
			variant={Boolean.match(failed, {onFalse: () => 'ghost' as const, onTrue: () => 'destructive' as const})}
			size="icon-sm"
			className="ms-2.5 max-sm:size-11"
			aria-label={Boolean.match(failed, {
				onFalse: () => Boolean.match(copied, {onFalse: () => 'Copy MCP URL', onTrue: () => 'Copied'}),
				onTrue: () => 'Cannot copy'
			})}
			title={Boolean.match(failed, {onFalse: () => undefined, onTrue: () => 'Cannot copy'})}
			onClick={() => copy()}
		>
			{Boolean.match(copied, {onFalse: () => <CopyIcon />, onTrue: () => <CheckIcon />})}
		</Button>
	)
}

function GatewayProblem(props: {period: Period}) {
	return (
		<StaleProblem
			label="Out of date"
			readers={[serversAtom, mcpUsageAtom(props.period), aiKeysAtom, aiUsageAtom(props.period)]}
		/>
	)
}

function HomeRoute() {
	const search: Search = route.useSearch()
	const navigate = route.useNavigate()
	const period = Option.getOrElse(search.period, () => '7d' as const)
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
							onPeriod={next => {
								navigate({search: previous => ({...previous, period: next})})
							}}
						/>
						<CopyEndpoint />
					</>
				}
			/>
			<Page>
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

export const Route = createFileRoute('/(home)/')({
	component: HomeRoute,
	validateSearch: Schema.toStandardSchemaV1(Search)
})
