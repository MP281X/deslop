import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, Order, Record, String, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useState} from 'react'
import {toQR} from 'toqr'

import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Button} from '@deslop/components-web/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {FieldDescription} from '@deslop/components-web/ui/field'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@deslop/components-web/ui/table'
import {cn} from '@deslop/components-web/utils'

import android from '#lib/brands/android.svg'
import apple from '#lib/brands/apple.svg'
import chrome from '#lib/brands/chrome.svg'
import claude from '#lib/brands/claude.svg'
import codex from '#lib/brands/codex.svg'
import edge from '#lib/brands/edge.svg'
import firefox from '#lib/brands/firefox.svg'
import safari from '#lib/brands/safari.svg'
import {
	ageLabel,
	appOrigins,
	appsAtom,
	avatarUrl,
	catalogAtom,
	consentAtom,
	disconnectAtom,
	minuteAtom,
	minutesSince,
	newest,
	signInLabel,
	timeLabel
} from '#lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

// The link as a QR code, one square per dark module, inside the quiet zone scanners need.
export function QrCode(props: {className?: string; text: string}) {
	const modules = Array.fromIterable(toQR(props.text))
	const size = Math.sqrt(modules.length)
	return (
		<svg
			viewBox={`-2 -2 ${size + 4} ${size + 4}`}
			shapeRendering="crispEdges"
			fill="currentColor"
			className={props.className}
			aria-hidden="true"
		>
			<path
				d={pipe(
					modules,
					Array.map((dark, index) => ({dark, x: index % size, y: Math.floor(index / size)})),
					Array.filter(module => module.dark === 1),
					Array.map(module => `M${module.x} ${module.y}h1v1h-1z`),
					Array.join('')
				)}
			/>
		</svg>
	)
}

// A GitHub account's picture, or its first letter until the picture loads.
export function AccountAvatar(props: {id: string; name: string}) {
	return (
		<Avatar size="sm">
			<AvatarImage src={avatarUrl(props.id)} alt={props.name} />
			<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(props.name))}</AvatarFallback>
		</Avatar>
	)
}

// A glyph until the app's own icon loads, so a missing icon never draws the browser's broken image; no tile behind either.
export function AppIcon(props: {origin: string; small?: boolean}) {
	const [state, setState] = useState<'failed' | 'loaded' | 'loading'>('loading')
	return (
		<span
			className={cn(
				'text-muted-foreground relative flex shrink-0 items-center justify-center',
				Boolean.match(props.small === true, {onFalse: () => 'size-5', onTrue: () => 'size-4'})
			)}
		>
			{state !== 'loaded' && <AppWindowIcon className="size-4" />}
			{state !== 'failed' && (
				<img
					src={`${props.origin}/icon`}
					alt=""
					className={cn('pixelated absolute inset-0 size-full', state === 'loading' && 'invisible')}
					onLoad={() => setState('loaded')}
					onError={() => setState('failed')}
				/>
			)}
		</span>
	)
}

const BROWSERS: Record<string, string> = {Chrome: chrome, Edge: edge, Firefox: firefox, Safari: safari}

// A browser, harness or app platform's logo; `mono` marks a black one that turns white on the dark page.
function brandOf(client: Client) {
	if (client.kind === 'Browser') return Option.map(Record.get(BROWSERS, client.name), src => ({mono: false, src}))
	if (Option.isSome(String.match(/claude/iu)(client.name))) return Option.some({mono: false, src: claude})
	if (Option.isSome(String.match(/codex/iu)(client.name))) return Option.some({mono: true, src: codex})
	// The gateway runs on a server whatever device approved it, so its glyph wins over the device's logo.
	if (Option.isSome(String.match(/gateway/iu)(client.name))) return Option.none()
	if (Array.contains(['iPhone', 'iPad'], client.device)) return Option.some({mono: true, src: apple})
	if (client.device === 'Android') return Option.some({mono: false, src: android})
	return Option.none()
}

// `app` is the origin of the Deslop app the client is, such as Stash on an iPhone, whose own icon marks it.
type Client = {app: Option.Option<string>; device: string; kind: 'App' | 'Browser'; name: string}

// A brand's logo when the client has one, else a glyph for the gateway, a browser or the machine it runs on.
function Brand(props: {client: Client}) {
	return Option.match(brandOf(props.client), {
		onNone: () =>
			pipe(
				Match.value(props.client),
				Match.when({kind: 'Browser'}, () => <GlobeIcon />),
				Match.when(
					client => Option.isSome(String.match(/gateway/iu)(client.name)),
					() => <GraphIcon />
				),
				Match.orElse(() => <HardDrivesIcon />)
			),
		onSome: brand => <img src={brand.src} alt="" className={cn('size-3.5', brand.mono && 'dark:invert')} />
	})
}

// The kind of client: a Deslop app's own icon, else its brand or a glyph.
function ClientIcon(props: {client: Client}) {
	return Option.match(props.client.app, {
		onNone: () => <Brand client={props.client} />,
		onSome: origin => <AppIcon origin={origin} small />
	})
}

// One row of the grid: an app, opened from its name when it has a site or a URL scheme.
type Row = {name: string; open: Option.Option<string>; origin: string; web: boolean}

// One column of the grid: a client signed in on one device, all its sign-ins together, or the sign-in waiting for an answer.
type Column = {
	// The address it last called from.
	address: Option.Option<string>
	client: Client
	families: string[]
	key: string
	label: string
	lastActive: number
	pending: boolean
	resources: readonly PendingAuthorization['resources'][]
}

// A client's mark alone heads its column; hovering names it, its address and when it was active, and a click opens its sign-out.
function ColumnHead(props: {column: Column; now: number}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	const detail = Array.join(
		[
			Boolean.match(props.column.pending, {
				onFalse: () => {
					const minutes = minutesSince(props.column.lastActive, props.now)
					return `active ${Boolean.match(minutes < 1, {onFalse: () => `${ageLabel(minutes)} ago`, onTrue: () => 'now'})}`
				},
				onTrue: () => 'waiting for an answer'
			}),
			// A client whose platform is unknown is already named by its address.
			...Option.toArray(Option.filter(props.column.address, address => address !== props.column.client.device))
		],
		' · '
	)
	const name = `${props.column.label}, ${detail}`
	return (
		<TableHead className="px-0.5">
			<span className="flex flex-col items-center gap-0.5">
				{Boolean.match(props.column.pending, {
					onFalse: () => (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button variant="ghost" size="icon-sm" className="max-sm:size-11" title={name} aria-label={name} />
								}
							>
								<ClientIcon client={props.column.client} />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-auto min-w-48">
								<DropdownMenuGroup>
									<DropdownMenuLabel>
										<span className="text-foreground block text-sm">{props.column.label}</span>
										<span className="font-mono tabular-nums">{detail}</span>
									</DropdownMenuLabel>
								</DropdownMenuGroup>
								<DropdownMenuItem
									variant="destructive"
									disabled={AsyncResult.isWaiting(disconnection)}
									onClick={() => disconnect(props.column.families)}
								>
									Sign out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					),
					onTrue: () => (
						<span
							title={name}
							aria-label={name}
							role="img"
							className="ring-primary flex size-7 items-center justify-center rounded-sm ring-1"
						>
							<ClientIcon client={props.column.client} />
						</span>
					)
				})}
			</span>
		</TableHead>
	)
}

// A browser session reaches every web app, so it counts under each one with a site.
function reaches(resources: PendingAuthorization['resources'], origin: string, web: boolean) {
	const origins = appOrigins(resources)
	return Array.contains(origins, origin) || (Array.contains(origins, 'browser') && web)
}

function holds(column: Column, row: Row) {
	return Array.some(column.resources, resources => reaches(resources, row.origin, row.web))
}

// Where a column's client holds the app, a dot in Auth's hue; where the waiting sign-in asks for it, the same dot breathing.
function Cell(props: {column: Column; row: Row}) {
	const held = holds(props.column, props.row)
	return (
		<TableCell className="w-7 px-0 max-sm:w-14">
			<span className="flex justify-center">
				{Boolean.match(held, {
					onFalse: () => <StatusDot status="off" />,
					onTrue: () => <StatusDot waiting={props.column.pending} />
				})}
				<span className="sr-only">
					{pipe(
						Match.value({held, pending: props.column.pending}),
						Match.when({held: false}, () => 'not signed in'),
						Match.when({pending: true}, () => 'asked for'),
						Match.orElse(() => 'signed in')
					)}
				</span>
			</span>
		</TableCell>
	)
}

// A failed answer stays above the grid to retry. Where the sign-in started tells a stranger's code from one's own.
function Answer(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	const [choice, setChoice] = useState<boolean>()
	const waiting = AsyncResult.isWaiting(consent)
	return (
		<>
			<FieldDescription>
				{Boolean.match(props.request.kind === 'Browser', {
					onFalse: () =>
						`${signInLabel(props.request.clientName, props.request.device)} asks for the apps its column marks`,
					onTrue: () =>
						`Signs in ${signInLabel(props.request.clientName, props.request.device)} as you to every mp281x.xyz app for 30 days, including approving sign-ins`
				})}
				{Option.match(Option.fromUndefinedOr(props.request.address), {
					onNone: () => '',
					onSome: address => ` · from ${address}`
				})}
				. Approve only a code you started yourself.
			</FieldDescription>
			<ResultError result={consent} />
			<div className="grid grid-cols-2 gap-2">
				<Button
					size="lg"
					aria-label={`Approve ${signInLabel(props.request.clientName, props.request.device)}`}
					disabled={waiting}
					onClick={() => {
						setChoice(true)
						respond({accept: true, request: props.request})
					}}
				>
					{Boolean.match(waiting && choice === true, {onFalse: () => null, onTrue: () => <Spinner />})}
					Approve
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={waiting}
					onClick={() => {
						setChoice(false)
						respond({accept: false, request: props.request})
					}}
				>
					{Boolean.match(waiting && choice === false, {onFalse: () => null, onTrue: () => <Spinner />})}
					Deny
				</Button>
			</div>
		</>
	)
}

// The waiting sign-in leads, then one column per client and device, the most recently active first.
function columnsOf(
	pending: Option.Option<PendingAuthorization>,
	signIns: readonly SignedInApp[],
	catalog: readonly {name: string; origin: string}[]
) {
	function clientOf(name: string, device: string, kind: 'App' | 'Browser') {
		return {
			app: Option.map(
				Array.findFirst(catalog, app => kind === 'App' && String.toLowerCase(app.name) === String.toLowerCase(name)),
				app => app.origin
			),
			device,
			kind,
			name
		}
	}
	return [
		...Option.match(pending, {
			onNone: () => [],
			onSome: request => [
				{
					address: Option.fromUndefinedOr(request.address),
					client: clientOf(request.clientName, request.device, request.kind),
					families: [],
					key: 'pending',
					label: signInLabel(request.clientName, request.device),
					lastActive: 0,
					pending: true,
					resources: [request.resources]
				}
			]
		}),
		...pipe(
			Array.groupBy(signIns, signIn => signInLabel(signIn.client, signIn.device)),
			Record.values,
			Array.filter(Array.isReadonlyArrayNonEmpty),
			Array.sort(Order.flip(Order.mapInput(Order.Number, newest))),
			Array.map(group => ({
				address: pipe(
					Array.findFirst(group, signIn => signIn.lastActive === newest(group)),
					Option.flatMap(signIn => Option.fromUndefinedOr(signIn.address))
				),
				client: clientOf(group[0].client, group[0].device, group[0].kind),
				families: Array.map(group, signIn => signIn.family),
				key: signInLabel(group[0].client, group[0].device),
				label: signInLabel(group[0].client, group[0].device),
				lastActive: newest(group),
				pending: false,
				resources: Array.map(group, signIn => signIn.resources)
			}))
		)
	]
}

const appListAtom = Atom.make(get =>
	AsyncResult.all({catalog: get(catalogAtom), now: get(minuteAtom), signIns: get(appsAtom)})
)

// Apps down, signed-in clients across: a dot where one holds the other. Every app that announced itself, then any other a sign-in holds.
export function AppList(props: {pending: Option.Option<PendingAuthorization>}) {
	const data = useAtomSuspense(appListAtom).value
	const rows: Row[] = [
		...Array.map(data.catalog, app => ({
			name: app.name,
			open: Option.some(app.open),
			origin: app.origin,
			web: String.startsWith('https://')(app.open)
		})),
		...pipe(
			[
				...Array.flatMap(data.signIns, signIn => appOrigins(signIn.resources)),
				...Option.match(props.pending, {onNone: () => [], onSome: request => appOrigins(request.resources)})
			],
			Array.dedupe,
			Array.filter(origin => origin !== 'browser' && !Array.some(data.catalog, app => app.origin === origin)),
			Array.sort(String.Order),
			Array.map(origin => ({
				name: Option.getOrElse(Array.head(String.split(new URL(origin).hostname, '.')), () => origin),
				open: Option.none<string>(),
				origin,
				web: false
			}))
		)
	]
	// Narrowing the apps narrows the clients to those holding one, so no column stands empty.
	const columns = Array.filter(columnsOf(props.pending, data.signIns, data.catalog), column =>
		Array.some(rows, row => holds(column, row))
	)
	return (
		<section className="flex flex-1 flex-col gap-3" aria-label="Apps">
			{/* A waiting sign-in's answer comes first, where the approving phone sees it without scrolling. */}
			{Option.match(props.pending, {
				onNone: () => null,
				onSome: request => (
					<>
						<Answer request={request} />
						<p className="text-muted-foreground font-mono text-xs">open until {timeLabel(request.expiresAt)}</p>
					</>
				)
			})}
			{Array.match(rows, {
				onEmpty: () => (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No apps yet</EmptyTitle>
						</EmptyHeader>
					</Empty>
				),
				onNonEmpty: () => (
					<div className="flex flex-col gap-3">
						<Table aria-label="Apps and the clients signed in to them" className="w-auto border-b">
							<TableHeader>
								<TableRow className="max-sm:h-11">
									<TableHead className="bg-background sticky left-0 z-10 w-40">
										<span className="text-muted-foreground text-xs">App</span>
									</TableHead>
									{Array.map(columns, column => (
										<ColumnHead key={column.key} column={column} now={data.now} />
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{Array.map(rows, row => (
									<TableRow key={row.origin} className="max-sm:h-11">
										<TableHead scope="row" className="bg-background sticky left-0 z-10 w-40">
											{Option.match(row.open, {
												onNone: () => (
													<span className="flex items-center gap-2 text-sm font-medium">
														<AppIcon origin={row.origin} />
														{row.name}
													</span>
												),
												onSome: url => (
													<a
														href={url}
														target="_blank"
														rel="noreferrer"
														className="flex h-full w-full items-center gap-2 text-sm font-medium hover:underline"
													>
														<AppIcon origin={row.origin} />
														{row.name}
													</a>
												)
											})}
										</TableHead>
										{Array.map(columns, column => (
											<Cell key={column.key} column={column} row={row} />
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)
			})}
		</section>
	)
}
