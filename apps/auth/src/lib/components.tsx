import {useAtom} from '@effect/atom-react'

import {Array, Boolean, DateTime, Function, Option, Order, Record, Schema, String, Struct, pipe} from 'effect'

import {AppWindowIcon, GlobeIcon, GraphIcon, HardDrivesIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ComponentType, ReactNode, SVGProps} from 'react'

import {EmptyState, Loaded} from '@deslop/components-web/fallbacks'
import {RowsSkeleton} from '@deslop/components-web/item-list'
import {ThemedMark} from '@deslop/components-web/marks'
import {ItemResultError} from '@deslop/components-web/result-error'
import {Avatar, AvatarFallback, AvatarImage} from '@deslop/components-web/ui/avatar'
import {Button} from '@deslop/components-web/ui/button'
import {Card, CardContent} from '@deslop/components-web/ui/card'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle
} from '@deslop/components-web/ui/item'
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
import {ageOf} from '@deslop/runtime/shared/format'

import {appsAtom, consentAtom, minuteAtom, requestCode} from '#lib/auth.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

type ClientKind = typeof ClientKind.Type
const ClientKind = Schema.Literals(['App', 'Browser'])

// The app's own icon, or a glyph while it loads or when it has none.
function AppIcon(props: {origin: string}) {
	return (
		<Avatar size="sm">
			<AvatarImage src={`${props.origin}/icon`} alt="" />
			<AvatarFallback>
				<AppWindowIcon />
			</AvatarFallback>
		</Avatar>
	)
}

// A card of list rows: the one frame every Auth list and its loading rows share.
export function ListCard(props: {children: ReactNode}) {
	return (
		<Card>
			<CardContent>{props.children}</CardContent>
		</Card>
	)
}

// The signed-in rows a card will hold while its data loads, a looked-up sign-in's row first when one is coming.
export function SignInRowsSkeleton(props: {pending?: boolean}) {
	return (
		<ListCard>
			<RowsSkeleton
				label="Signed in"
				rows={Boolean.match(props.pending === true, {onFalse: Function.constant(9), onTrue: Function.constant(10)})}
			/>
		</ListCard>
	)
}

// The people rows a card will hold while the list loads.
export function PeopleRowsSkeleton() {
	return (
		<ListCard>
			<RowsSkeleton label="People" rows={3} />
		</ListCard>
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

function ClientIcon(props: {client: Client}) {
	return Option.match(props.client.app, {
		onNone: () => <Brand client={props.client} />,
		onSome: origin => <AppIcon origin={origin} />
	})
}

function ClientRow(props: {client: SignedInApp; now: DateTime.Utc}) {
	const active = ageOf(props.client.lastActive, props.now)
	return (
		<Item role="listitem" size="sm" aria-label={`${props.client.device}, active ${active}`}>
			<ItemMedia variant="icon" role="img" aria-label={props.client.client} title={props.client.client}>
				<ClientIcon
					client={{
						app: props.client.icon,
						device: props.client.device,
						kind: props.client.kind,
						name: props.client.client
					}}
				/>
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.client.device}</ItemTitle>
				{pipe(
					props.client.address,
					Option.filter(value => value !== props.client.device),
					Option.match({onNone: Function.constNull, onSome: value => <ItemDescription>{value}</ItemDescription>})
				)}
			</ItemContent>
			<ItemActions>
				<span className="text-muted-foreground tabular-nums">{active}</span>
			</ItemActions>
		</Item>
	)
}

// A waiting sign-in's mark: the app's own icon from its registered callback, else a browser or a host.
export function RequestMark(props: {request: PendingAuthorization}) {
	return Option.match(props.request.icon, {
		onNone: () =>
			Boolean.match(props.request.kind === 'Browser', {onFalse: () => <HardDrivesIcon />, onTrue: () => <GlobeIcon />}),
		onSome: origin => <AppIcon origin={origin} />
	})
}

// A waiting sign-in leads the card, outlined, its code under the label; its answer stays on the row.
function PendingRow(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	const waiting = AsyncResult.isWaiting(consent)
	return (
		<Item role="listitem" size="sm" variant="outline">
			<ItemMedia variant="icon" role="img" aria-label={props.request.clientName} title={props.request.clientName}>
				<RequestMark request={props.request} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.request.device}</ItemTitle>
				<ItemDescription>{requestCode(props.request.id)}</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button
					variant="outline"
					disabled={waiting}
					aria-label={`Deny ${props.request.device}`}
					onClick={() => respond({accept: false, request: props.request})}
				>
					Deny
				</Button>
				<Button
					disabled={waiting}
					aria-label={`Approve ${props.request.device}`}
					onClick={() => respond({accept: true, request: props.request})}
				>
					Approve
				</Button>
			</ItemActions>
			<ItemResultError result={consent} />
		</Item>
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
					return <EmptyState label="No sign-ins" icon={<HardDrivesIcon className="size-5" weight="light" />} />
				}
				return (
					<ListCard>
						<ItemGroup aria-label="Signed-in clients">
							{checking && <RowsSkeleton label="Checking the code" rows={1} />}
							{Option.match(props.pending, {
								onNone: Function.constNull,
								onSome: request => <PendingRow request={request} />
							})}
							{Array.map(clients, client => (
								<ClientRow key={client.family} client={client} now={sessions.now} />
							))}
						</ItemGroup>
					</ListCard>
				)
			}}
		</Loaded>
	)
}
