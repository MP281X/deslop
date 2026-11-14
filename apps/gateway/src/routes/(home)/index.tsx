import {useAtom, useAtomSet} from '@effect/atom-react'

import {Array, Boolean, Function, Number, Option, Order, Schema, String, pipe} from 'effect'

import {HardDrivesIcon, LinkIcon, WrenchIcon} from '@phosphor-icons/react'
import {CatchBoundary, createFileRoute, getRouteApi} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactNode} from 'react'
import {Line, LineChart, YAxis} from 'recharts'

import {CopyButton} from '@deslop/components-web/blocks/copy-button'
import {ImageMark} from '@deslop/components-web/blocks/marks'
import {StaleProblem} from '@deslop/components-web/blocks/problem'
import {ChoiceRow, LoadingRow, RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded, ReadFailure} from '@deslop/components-web/blocks/states'
import {StatusDot} from '@deslop/components-web/blocks/status-dot'
import {AppBar, AppBarChoice} from '@deslop/components-web/shell/app-bar'
import {Page} from '@deslop/components-web/shell/page'
import {Button} from '@deslop/components-web/ui/button'
import {ChartContainer} from '@deslop/components-web/ui/chart'
import type {ChartConfig} from '@deslop/components-web/ui/chart'
import {Field, FieldError, FieldGroup} from '@deslop/components-web/ui/field'
import {InputGroup, InputGroupAddon, InputGroupInput} from '@deslop/components-web/ui/input-group'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {countOf} from '@deslop/runtime/shared/format'

import {
	addAtom,
	addEvents,
	aiKeyAtom,
	aiUsageAtom,
	connectAtom,
	mcpUsageAtom,
	serversAtom,
	setKeyAtom
} from '#lib/gateway.ts'
import {Search} from '#lib/search.ts'
import {AddKeyDialog, ProviderMark} from '#routes/(home)/-keys.tsx'
import {aiCost, aiSeries, serverSeries} from '#routes/(home)/-usage.ts'
import icon from '#routes/icon.svg'
import {Payer} from '#services/ai-metering/schema.ts'
import type {AiUsageReport} from '#services/ai-metering/schema.ts'
import type {AiKeyItem} from '#services/ai-proxy/schema.ts'
import {ConnectionUrl, ServiceAccountKey} from '#services/ai-proxy/schema.ts'
import type {ConnectionItem, McpUsageServer} from '#services/connections/schema.ts'
import {Period} from '#services/usage/schema.ts'
import type {UsageRange} from '#services/usage/schema.ts'

// The list's columns: name, tools, sparkline, total.
const COLUMNS = 4
const SPARKLINE = {calls: {color: 'var(--muted-foreground)'}} satisfies ChartConfig
const PAYER_LABELS: Record<Payer, string> = {balance: 'Zen balance', byok: 'Anthropic key'}
const PERIODS = Array.map(Period.literals, value => ({label: value, value}))

const route = getRouteApi('/(home)/')

function urgency(server: ConnectionItem) {
	if (Option.isSome(server.error) || server.status === 'Expired') return 0
	if (server.status === 'Not connected') return 1
	return 2
}
const byUrgency = Order.mapInput(Order.Number, urgency)

// A 64×14 line of the period's figures; zeros rest on the baseline.
function Sparkline(props: {values: readonly number[]}) {
	return (
		<div aria-hidden className="flex h-3.5 w-16">
			<ChartContainer config={SPARKLINE} className="flex-1">
				<LineChart data={Array.map(props.values, calls => ({calls}))} margin={{bottom: 1, left: 1, right: 1, top: 1}}>
					<YAxis hide domain={[0, 'dataMax']} />
					<Line
						dataKey="calls"
						type="linear"
						stroke="var(--color-calls)"
						strokeWidth={1.5}
						dot={false}
						isAnimationActive={false}
					/>
				</LineChart>
			</ChartContainer>
		</div>
	)
}

// The server's first icon that loads, else a server glyph; icons a later discovery finds get their turn. Without a tile behind it, an icon drawn for dark backgrounds goes first.
function ServerIcon(props: {server: ConnectionItem}) {
	const host = new URL(props.server.url).hostname
	return (
		<ImageMark
			fallback={<HardDrivesIcon className="size-4" />}
			sources={pipe(
				props.server.icons,
				Array.sort(
					Order.mapInput(
						Order.Boolean,
						(entry: ConnectionItem['icons'][number]) => !Option.contains(entry.theme, 'dark')
					)
				),
				Array.map(entry => entry.src),
				Array.appendAll([
					`https://${host}/favicon.ico`,
					`https://${String.replace(/^(?:api|app|mcp)\./u, '')(host)}/favicon.ico`
				] as const),
				Array.dedupe
			)}
		/>
	)
}

// A row's period: its sparkline from the small breakpoint, then its total.
function FiguresCells(props: {figure: string; series: readonly number[]}) {
	return (
		<>
			<TableCell className="hidden sm:table-cell">
				<Sparkline values={props.series} />
			</TableCell>
			<TableCell className="text-right">
				<span className="tabular-nums">{props.figure}</span>
			</TableCell>
		</>
	)
}

// A list group's failed read, across the whole row.
function FailureRow(props: {children: ReactNode}) {
	return (
		<TableRow>
			<TableCell colSpan={COLUMNS}>{props.children}</TableCell>
		</TableRow>
	)
}

// One server: its mark, name and host, then what it offers and its calls over the period, or in their place the button that connects it.
function ServerRow(props: {period: UsageRange; report: readonly McpUsageServer[]; server: ConnectionItem}) {
	const [connecting, connect] = useAtom(connectAtom(props.server.id))
	const connected = props.server.status === 'Connected'
	const needsUser = !connected || Option.isSome(props.server.error)
	const failed = props.server.status === 'Expired' || Option.isSome(props.server.error)
	// A fixed name per failure: the upstream's own text can carry a response body or a bearer token.
	const failure = Boolean.match(props.server.status === 'Expired', {
		onFalse: Function.constant('Server unavailable'),
		onTrue: Function.constant('Authorization expired')
	})
	const action = Boolean.match(connected, {
		onFalse: Function.constant('Connect' as const),
		onTrue: Function.constant('Reconnect' as const)
	})
	const series = serverSeries(props.report, props.server.id, props.period)
	return (
		<TableRow>
			<RowLead
				mark={<ServerIcon server={props.server} />}
				after={failed && <StatusDot status="error" label={failure} />}
				detail={new URL(props.server.url).hostname}
			>
				{props.server.name}
			</RowLead>
			{Boolean.match(needsUser, {
				onFalse: () => (
					<>
						<TableCell className="text-right">
							{props.server.tools > 0 && (
								<span className="text-muted-foreground inline-flex items-center gap-1.5 tabular-nums" title="Tools">
									{props.server.tools}
									<WrenchIcon />
								</span>
							)}
						</TableCell>
						<FiguresCells figure={countOf(Number.sumAll(series))} series={series} />
					</>
				),
				onTrue: () => (
					<TableCell colSpan={3} className="text-right">
						<Button
							size="xs"
							disabled={AsyncResult.isWaiting(connecting)}
							aria-label={`${action} ${props.server.name}`}
							onClick={() => connect()}
						>
							{action}
						</Button>
					</TableCell>
				)
			})}
		</TableRow>
	)
}

function RowReadFailure(props: {error: unknown; reset: () => void}) {
	return (
		<FailureRow>
			<ReadFailure error={props.error} reset={props.reset} />
		</FailureRow>
	)
}

// The rows a group will hold while it loads.
function GroupLoading(props: {label: string; rows: number}) {
	return Array.map(Array.range(1, props.rows), row => <LoadingRow key={row} columns={COLUMNS} label={props.label} />)
}

// The servers reader first, so a refusal or a failed read shows without waiting for usage.
function ServerRows(props: {period: Period}) {
	return (
		<Loaded atom={serversAtom} frame={failure => <FailureRow>{failure}</FailureRow>}>
			{servers =>
				pipe(
					servers,
					Array.sort(byUrgency),
					Array.match({
						onEmpty: Function.constNull,
						onNonEmpty: ordered => (
							<Suspense fallback={<GroupLoading label="MCP servers" rows={ordered.length} />}>
								<Loaded atom={mcpUsageAtom(props.period)} frame={failure => <FailureRow>{failure}</FailureRow>}>
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

// One payer of the saved key, in a server row's shape: its figure and range; the whole row opens the key's dialog.
function PayerRow(props: {
	info: AiKeyItem
	onOpen: () => void
	period: UsageRange
	report: AiUsageReport
	source: Payer
}) {
	return (
		<ChoiceRow label={`OpenCode, ${PAYER_LABELS[props.source]}`} selected={false} onSelect={props.onOpen}>
			<RowLead
				mark={<ProviderMark />}
				after={
					Option.exists(props.info.lastStatus, status => status === 401 || status === 403) && (
						<StatusDot status="error" label="Key refused" />
					)
				}
				detail={PAYER_LABELS[props.source]}
			>
				OpenCode
			</RowLead>
			<TableCell />
			<FiguresCells
				figure={aiCost(props.report, props.source)}
				series={aiSeries(props.report, props.source, props.period)}
			/>
		</ChoiceRow>
	)
}

function KeyUsage(props: {info: AiKeyItem; onOpen: () => void; period: Period}) {
	return (
		<Loaded atom={aiUsageAtom(props.period)} frame={failure => <FailureRow>{failure}</FailureRow>}>
			{current =>
				Array.map(Payer.literals, source => (
					<PayerRow
						key={source}
						info={props.info}
						onOpen={props.onOpen}
						report={current.report}
						period={current.range}
						source={source}
					/>
				))
			}
		</Loaded>
	)
}

// The saved credential has a row for each payer it spends from; the field adds or replaces it.
function KeyRows(props: {onOpen: () => void; period: Period}) {
	return (
		<Loaded atom={aiKeyAtom} frame={failure => <FailureRow>{failure}</FailureRow>}>
			{all =>
				Option.match(all, {
					onNone: Function.constNull,
					onSome: credential => (
						<Suspense fallback={<GroupLoading label="OpenCode key" rows={Payer.literals.length} />}>
							<KeyUsage info={credential} onOpen={props.onOpen} period={props.period} />
						</Suspense>
					)
				})
			}
		</Loaded>
	)
}

// Each group is read on its own, so one failing reader leaves the other group's rows.
function List(props: {onOpen: () => void; period: Period}) {
	return (
		<Table role="grid" aria-label="MCP servers and AI keys">
			<TableBody>
				<CatchBoundary getResetKey={Function.constant('servers')} errorComponent={RowReadFailure}>
					<Suspense fallback={<GroupLoading label="MCP servers" rows={3} />}>
						<ServerRows period={props.period} />
					</Suspense>
				</CatchBoundary>
				<CatchBoundary getResetKey={Function.constant('keys')} errorComponent={RowReadFailure}>
					<Suspense fallback={<GroupLoading label="AI keys" rows={2} />}>
						<KeyRows onOpen={props.onOpen} period={props.period} />
					</Suspense>
				</CatchBoundary>
			</TableBody>
		</Table>
	)
}

// The field adds a server URL through the existing flow, or opens the key flow with a pasted key.
function AddField(props: {onKey: (secret: string, url: string) => void}) {
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
				Option.getOrElse(Function.constant(''))
			)
		)
	)
	const error = Option.flatMap(editing, state => state.error)
	const busy = Option.isSome(adding)
	function submit() {
		const value = String.trim(typed)
		if (value === '' || busy) return
		if (Schema.is(ConnectionUrl)(value)) {
			props.onKey('', value)
			send(addEvents.Typed({url: ''}))
			return
		}
		if (Schema.is(ServiceAccountKey)(value)) {
			props.onKey(value, '')
			send(addEvents.Typed({url: ''}))
			return
		}
		if (
			Option.isNone(Option.liftThrowable(() => new URL(value))()) ||
			String.includes('opencode.ai/inference/')(value)
		) {
			send(
				addEvents.Invalid({
					message: 'Enter a full HTTPS MCP or Console API URL, or an OpenCode service account key starting with oc_sk_.'
				})
			)
			return
		}
		send(addEvents.Submit())
	}
	return (
		<form
			onSubmit={event => {
				event.preventDefault()
				submit()
			}}
		>
			<FieldGroup>
				<Field data-invalid={Option.isSome(error)}>
					<InputGroup>
						<InputGroupAddon>
							<LinkIcon />
						</InputGroupAddon>
						<InputGroupInput
							aria-label="MCP server URL or provider key"
							aria-invalid={Option.isSome(error)}
							aria-describedby="gateway-add-error"
							placeholder="Paste an MCP URL or a key"
							autoComplete="off"
							spellCheck={false}
							value={typed}
							disabled={busy}
							onChange={event => send(addEvents.Typed({url: event.target.value}))}
						/>
					</InputGroup>
					{Option.match(error, {
						onNone: Function.constNull,
						onSome: message => <FieldError id="gateway-add-error">{message}</FieldError>
					})}
				</Field>
			</FieldGroup>
		</form>
	)
}

function GatewayProblem(props: {period: Period}) {
	return (
		<StaleProblem
			label="Out of date"
			readers={[serversAtom, mcpUsageAtom(props.period), aiKeyAtom, aiUsageAtom(props.period)]}
		/>
	)
}

function HomeRoute() {
	const search: Search = route.useSearch()
	const navigate = route.useNavigate()
	const period = Option.getOrElse(search.period, Function.constant('24h' as const))
	// Open, which opening it is (so each starts with the pasted secret), and the provider it adds.
	const [keyDialog, setKeyDialog] = useState<{open: boolean; opened: number; secret: string; url: string}>({
		open: false,
		opened: 0,
		secret: '',
		url: ''
	})
	const resetKey = useAtomSet(setKeyAtom)
	function addKey(secret: string, url: string) {
		resetKey(Atom.Reset)
		setKeyDialog(previous => ({open: true, opened: previous.opened + 1, secret, url}))
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<AppBar
				icon={icon}
				name="gateway"
				controls={
					<>
						<GatewayProblem period={period} />
						<AppBarChoice
							label="Range"
							options={PERIODS}
							value={period}
							onChange={next => {
								navigate({search: previous => ({...previous, period: next})})
							}}
						/>
						<CopyButton label="Copy MCP URL" value={`${window.location.origin}/mcp`} size="icon-sm" />
					</>
				}
			/>
			<Page>
				<h1 className="sr-only">Gateway</h1>
				<AddField onKey={addKey} />
				<List onOpen={() => addKey('', '')} period={period} />
			</Page>
			<AddKeyDialog
				key={keyDialog.opened}
				open={keyDialog.open}
				secret={keyDialog.secret}
				url={keyDialog.url}
				onOpenChange={open => setKeyDialog(previous => ({...previous, open}))}
			/>
		</div>
	)
}

export const Route = createFileRoute('/(home)/')({
	component: HomeRoute,
	validateSearch: Schema.toStandardSchemaV1(Search)
})
