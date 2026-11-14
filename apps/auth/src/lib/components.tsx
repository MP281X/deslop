import {useAtom} from '@effect/atom-react'

import {Array, Boolean, DateTime, Function, Option, Order, Record, Schema, String, Struct, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ComponentType, ReactNode, SVGProps} from 'react'

import {ImageMark, ThemedMark} from '@deslop/components-web/blocks/marks'
import {ResultError} from '@deslop/components-web/blocks/result-error'
import {LoadingRows, RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded} from '@deslop/components-web/blocks/states'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {AndroidIcon} from '@deslop/components-web/ui/svgs/androidIcon'
import {Apple} from '@deslop/components-web/ui/svgs/apple'
import {AppleDark} from '@deslop/components-web/ui/svgs/appleDark'
import {Chrome} from '@deslop/components-web/ui/svgs/chrome'
import {ClaudeAiIcon} from '@deslop/components-web/ui/svgs/claudeAiIcon'
import {CodexDark} from '@deslop/components-web/ui/svgs/codexDark'
import {CodexLight} from '@deslop/components-web/ui/svgs/codexLight'
import {Edge} from '@deslop/components-web/ui/svgs/edge'
import {Firefox} from '@deslop/components-web/ui/svgs/firefox'
import {Safari} from '@deslop/components-web/ui/svgs/safari'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {ageOf} from '@deslop/runtime/shared/format'

import {appsAtom, consentAtom, minuteAtom, requestCode} from '#lib/auth.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

type ClientKind = typeof ClientKind.Type
const ClientKind = Schema.Literals(['App', 'Browser'])

// Every row's mark sits in the same square, so an app's own 24px icon and a 16px glyph start their names at one column.
function Square(props: {children: ReactNode}) {
	return <span className="flex size-6 shrink-0 items-center justify-center">{props.children}</span>
}

// The signed-in rows while the list loads, a looked-up sign-in's row first when one is coming.
export function SignInRowsSkeleton(props: {pending?: boolean}) {
	return (
		<LoadingRows
			label="Signed in"
			rows={Boolean.match(props.pending === true, {onFalse: Function.constant(9), onTrue: Function.constant(10)})}
		/>
	)
}

const BROWSERS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {Chrome, Edge, Firefox, Safari}

type Client = {app: Option.Option<string>; device: string; kind: ClientKind; name: string}

function Brand(props: {client: Client}) {
	if (props.client.kind === 'Browser') {
		return pipe(
			BROWSERS,
			Record.get(props.client.name),
			Option.match({onNone: () => <GlobeIcon />, onSome: Mark => <Mark aria-hidden className="size-3.5" />})
		)
	}
	if (Option.isSome(String.match(/claude/iu)(props.client.name))) {
		return <ClaudeAiIcon aria-hidden className="size-3.5" />
	}
	if (Option.isSome(String.match(/codex/iu)(props.client.name))) {
		return <ThemedMark light={CodexLight} dark={CodexDark} className="size-3.5" />
	}
	// The gateway runs on a server whatever device approved it, so its glyph wins over the device's logo.
	if (Option.isSome(String.match(/gateway/iu)(props.client.name))) return <GraphIcon />
	if (Array.contains(['iPhone', 'iPad'], props.client.device)) {
		return <ThemedMark light={Apple} dark={AppleDark} className="size-3.5" />
	}
	if (props.client.device === 'Android') return <AndroidIcon aria-hidden className="size-3.5" />
	return <HardDrivesIcon />
}

// An app's own icon from its origin, square at the registry's media size, else the app glyph.
function AppIcon(props: {origin: string}) {
	return <ImageMark sources={[`${props.origin}/icon`]} fallback={<AppWindowIcon />} />
}

function ClientIcon(props: {client: Client}) {
	return Option.match(props.client.app, {
		onNone: () => (
			<Square>
				<Brand client={props.client} />
			</Square>
		),
		onSome: origin => <AppIcon origin={origin} />
	})
}

// One client: its mark, device and last address, then how long ago it was active.
function ClientRow(props: {client: SignedInApp; now: DateTime.Utc}) {
	const active = ageOf(props.client.lastActive, props.now)
	return (
		<TableRow aria-label={`${props.client.device}, active ${active}`}>
			<RowLead
				mark={
					<span role="img" aria-label={props.client.client} title={props.client.client}>
						<ClientIcon
							client={{
								app: props.client.icon,
								device: props.client.device,
								kind: props.client.kind,
								name: props.client.client
							}}
						/>
					</span>
				}
				detail={pipe(
					props.client.address,
					Option.filter(value => value !== props.client.device),
					Option.getOrUndefined
				)}
			>
				{props.client.device}
			</RowLead>
			<TableCell className="text-right">
				<span className="text-muted-foreground tabular-nums">{active}</span>
			</TableCell>
		</TableRow>
	)
}

// A waiting sign-in's mark: the app's own icon from its registered callback, else a browser or a host.
export function RequestMark(props: {request: PendingAuthorization}) {
	return Option.match(props.request.icon, {
		onNone: () => (
			<Square>
				{Boolean.match(props.request.kind === 'Browser', {
					onFalse: () => <HardDrivesIcon />,
					onTrue: () => <GlobeIcon />
				})}
			</Square>
		),
		onSome: origin => <AppIcon origin={origin} />
	})
}

// A waiting sign-in leads the list as the selected row, its code beside the device; its answer stays on the row.
function PendingRow(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	const waiting = AsyncResult.isWaiting(consent)
	return (
		<TableRow data-state="selected">
			<RowLead
				mark={
					<span role="img" aria-label={props.request.clientName} title={props.request.clientName}>
						<RequestMark request={props.request} />
					</span>
				}
				after={<ResultError result={consent} />}
				detail={requestCode(props.request.id)}
			>
				{props.request.device}
			</RowLead>
			<TableCell>
				<span className="flex gap-2">
					<Button
						size="xs"
						variant="outline"
						disabled={waiting}
						aria-label={`Deny ${props.request.device}`}
						onClick={() => respond({accept: false, request: props.request})}
					>
						Deny
					</Button>
					<Button
						size="xs"
						disabled={waiting}
						aria-label={`Approve ${props.request.device}`}
						onClick={() => respond({accept: true, request: props.request})}
					>
						Approve
					</Button>
				</span>
			</TableCell>
		</TableRow>
	)
}

function newest(apps: readonly [SignedInApp, ...SignedInApp[]]) {
	return Array.reduce(apps, apps[0].lastActive, (latest, app) => DateTime.max(latest, app.lastActive))
}

function clientsOf(signIns: readonly SignedInApp[]) {
	return pipe(
		Array.groupBy(signIns, signIn => `${signIn.client} · ${signIn.device}`),
		Record.values,
		Array.filter(Array.isReadonlyArrayNonEmpty),
		Array.sort(Order.flip(Order.mapInput(DateTime.Order, newest))),
		Array.map(group => {
			const lastActive = newest(group)
			return {
				...Struct.pick(group[0], ['client', 'device', 'family', 'icon', 'kind', 'parent']),
				address: pipe(
					group,
					Array.findFirst(signIn => DateTime.Equivalence(signIn.lastActive, lastActive)),
					Option.flatMap(signIn => signIn.address)
				),
				lastActive
			}
		})
	)
}

// A retry restarts the live sign-ins reader.
const signInListAtom = Atom.readable(
	get => AsyncResult.all({now: get(minuteAtom), signIns: get(appsAtom)}),
	refresh => {
		refresh(appsAtom)
	}
)

export function SignInList(props: {checking?: boolean; pending: Option.Option<PendingAuthorization>}) {
	return (
		<Loaded atom={signInListAtom}>
			{sessions => {
				const clients = clientsOf(sessions.signIns)
				const checking = props.checking === true && Option.isNone(props.pending)
				if (Array.isReadonlyArrayEmpty(clients) && Option.isNone(props.pending) && !checking) {
					return (
						<Empty role="status">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<HardDrivesIcon />
								</EmptyMedia>
								<EmptyTitle>No sign-ins</EmptyTitle>
							</EmptyHeader>
						</Empty>
					)
				}
				return (
					<Table aria-label="Signed-in clients">
						<TableBody>
							{checking && (
								<TableRow aria-busy="true" aria-label="Checking the code">
									<TableCell colSpan={2}>
										<Skeleton className="h-6 w-1/3" />
									</TableCell>
								</TableRow>
							)}
							{Option.match(props.pending, {
								onNone: Function.constNull,
								onSome: request => <PendingRow request={request} />
							})}
							{Array.map(clients, client => (
								<ClientRow key={client.family} client={client} now={sessions.now} />
							))}
						</TableBody>
					</Table>
				)
			}}
		</Loaded>
	)
}
