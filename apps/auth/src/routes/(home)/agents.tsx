import {useAtom, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {KeyRound, Plus} from 'lucide-react'
import {Suspense, useState} from 'react'

import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle} from '@deslop/components-web/ui/card'
import {
	CodeBlock,
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockCopyButton,
	CodeBlockHeader,
	CodeBlockTitle
} from '@deslop/components-web/ui/code-block'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components-web/ui/select'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@deslop/components-web/ui/table'
import {MCP_PATH} from '@deslop/runtime/schema'

import {
	ageLabel,
	appsAtom,
	catalogAtom,
	createAgentAtom,
	dateLabel,
	dayLabel,
	minuteAtom,
	minutesSince,
	revokeAgentAtom
} from '#lib/utils.ts'
import type {AgentParams, SignedInApp} from '#services/tokens/schema.ts'

const EXPIRY = [
	{days: 30, label: '30 days'},
	{days: 90, label: '90 days'},
	{days: 365, label: '1 year'}
] as const

type Days = AgentParams['days']

const EXPIRY_ITEMS = Array.map(EXPIRY, option => ({label: option.label, value: `${option.days}`}))

// The token is shown once, with the command that adds the gateway to an agent's machine; Auth keeps only its hash.
function CreatedToken(props: {expiresAt: number; onDone: () => void; resource: string; token: string}) {
	const command = Array.join(
		[
			'claude mcp remove gateway',
			`claude mcp add --transport http gateway ${props.resource} --header "Authorization: Bearer ${props.token}"`
		],
		'\n'
	)
	return (
		<Card>
			<CardHeader>
				<CardTitle>Token created</CardTitle>
				<CardDescription>Shown once. Expires {dateLabel(props.expiresAt)}.</CardDescription>
				<CardAction>
					<Button variant="ghost" size="sm" onClick={props.onDone}>
						Done
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<CodeBlock size="sm">
					<CodeBlockHeader>
						<CodeBlockTitle>Token</CodeBlockTitle>
						<CodeBlockActions>
							<CodeBlockCopyButton aria-label="Copy the token" value={props.token} />
						</CodeBlockActions>
					</CodeBlockHeader>
					<CodeBlockContent wrap>
						<span className="min-w-0 wrap-anywhere">{props.token}</span>
					</CodeBlockContent>
				</CodeBlock>
				<CodeBlock size="sm">
					<CodeBlockHeader>
						<CodeBlockTitle>Claude Code, on the agent’s machine</CodeBlockTitle>
						<CodeBlockActions>
							<CodeBlockCopyButton aria-label="Copy the command" value={command} />
						</CodeBlockActions>
					</CodeBlockHeader>
					<CodeBlockContent wrap>
						<span className="min-w-0 wrap-anywhere">{command}</span>
					</CodeBlockContent>
				</CodeBlock>
			</CardContent>
		</Card>
	)
}

// A name and an expiry, then the token and its command; the resource is the gateway's own MCP endpoint, so the token reaches nothing else.
function CreateAgent() {
	// The form renders at once; the gateway's resource only gates its submit.
	const resource = Option.map(
		Array.findFirst(
			AsyncResult.getOrElse(useAtomValue(catalogAtom), () => []),
			app => app.name === 'gateway'
		),
		app => new URL(MCP_PATH, app.origin).href
	)
	const [name, setName] = useState('')
	const [days, setDays] = useState<Days>(365)
	const [created, create] = useAtom(createAgentAtom)
	const [dismissed, setDismissed] = useState<string>()
	const waiting = AsyncResult.isWaiting(created)
	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>Create an agent token</CardTitle>
					<CardDescription>For the Gateway’s MCP endpoint, from a machine without a browser.</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="flex flex-col gap-4"
						onSubmit={event => {
							event.preventDefault()
							Option.match(resource, {
								onNone: () => undefined,
								onSome: target => create({days, name: String.trim(name), resource: target})
							})
						}}
					>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="agent-name">Name</FieldLabel>
								<Input
									id="agent-name"
									autoComplete="off"
									className="max-sm:h-11"
									maxLength={60}
									placeholder="e.g. desktop"
									required
									value={name}
									onChange={event => setName(event.target.value)}
								/>
								<FieldDescription>The machine or agent this token is for.</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor="agent-expiry">Expires</FieldLabel>
								<Select
									items={EXPIRY_ITEMS}
									value={`${days}`}
									onValueChange={value => {
										Option.match(
											Option.flatMap(Option.fromNullishOr(value), current =>
												Array.findFirst(EXPIRY, option => `${option.days}` === current)
											),
											{onNone: () => undefined, onSome: option => setDays(option.days)}
										)
									}}
								>
									<SelectTrigger id="agent-expiry" className="w-full max-sm:h-11">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Array.map(EXPIRY, option => (
											<SelectItem key={option.days} value={`${option.days}`}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						</FieldGroup>
						{Option.match(resource, {
							onNone: () => <FieldDescription>The gateway has not announced itself to Auth yet.</FieldDescription>,
							onSome: () => null
						})}
						<ResultError result={created} />
						<Button
							type="submit"
							className="w-full max-sm:h-11"
							disabled={waiting || String.trim(name) === '' || Option.isNone(resource)}
						>
							{Boolean.match(waiting, {onFalse: () => <Plus />, onTrue: () => <Spinner />})}
							Create token
						</Button>
					</form>
				</CardContent>
			</Card>
			{Option.match(AsyncResult.value(created), {
				onNone: () => null,
				onSome: token =>
					Boolean.match(dismissed === token.token, {
						onFalse: () => (
							<CreatedToken
								expiresAt={token.expiresAt}
								onDone={() => setDismissed(token.token)}
								resource={Option.getOrElse(resource, () => '')}
								token={token.token}
							/>
						),
						onTrue: () => null
					})
			})}
		</>
	)
}

// "never" until its first call, then relative while it is recent, as the sign-ins grid names activity.
function usedLabel(app: SignedInApp, now: number) {
	if (app.lastActive === app.createdAt) return 'never'
	const minutes = minutesSince(app.lastActive, now)
	if (minutes < 1) return 'now'
	return `${ageLabel(minutes)} ago`
}

// One line per token: its name, when it was made, when it was last used and when it expires; its context menu revokes it.
function AgentRow(props: {app: SignedInApp; now: number}) {
	const [revoking, revoke] = useAtom(revokeAgentAtom)
	const name = Option.getOrElse(Option.fromUndefinedOr(props.app.agent), () => props.app.device)
	const used = usedLabel(props.app, props.now)
	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={
					<TableRow
						tabIndex={0}
						aria-haspopup="menu"
						aria-label={`${name}, last used ${used}, expires ${dateLabel(props.app.expiresAt)}`}
					/>
				}
			>
				<TableCell>
					<span className="flex min-w-0 items-center gap-2">
						<KeyRound className="text-muted-foreground size-3.5 shrink-0" />
						<span className="min-w-0 truncate font-medium">{name}</span>
					</span>
				</TableCell>
				<TableCell className="text-muted-foreground font-mono max-sm:hidden">{dayLabel(props.app.createdAt)}</TableCell>
				<TableCell className="text-muted-foreground font-mono">{used}</TableCell>
				<TableCell className="text-muted-foreground font-mono">{dateLabel(props.app.expiresAt)}</TableCell>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-auto min-w-36">
				<ContextMenuItem
					variant="destructive"
					disabled={AsyncResult.isWaiting(revoking)}
					onClick={() => revoke(props.app.family)}
				>
					Revoke
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

// Every token this account made, newest use first, as the apps stream sorts it.
function AgentList() {
	const apps = useAtomSuspense(appsAtom).value
	const now = useAtomSuspense(minuteAtom).value
	return Array.match(
		Array.filter(apps, app => app.agent !== undefined),
		{
			onEmpty: () => (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No agent tokens</EmptyTitle>
						<EmptyDescription>Create one above to connect an agent on another machine.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			),
			onNonEmpty: tokens => (
				<Table aria-label="Agent tokens" className="border-b">
					<TableHeader>
						<TableRow>
							<TableHead>Agent</TableHead>
							<TableHead className="max-sm:hidden">Created</TableHead>
							<TableHead>Last used</TableHead>
							<TableHead>Expires</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{Array.map(tokens, app => (
							<AgentRow key={app.family} app={app} now={now} />
						))}
					</TableBody>
				</Table>
			)
		}
	)
}

// The grid's page is wide for many clients; this form keeps to the design's form width.
function Agents() {
	return (
		<div className="mx-auto flex w-full max-w-xl flex-col gap-4">
			<CreateAgent />
			<Suspense fallback={<ItemListSkeleton label="Agent tokens" media rows={2} />}>
				<AgentList />
			</Suspense>
		</div>
	)
}

export const Route = createFileRoute('/(home)/agents')({component: Agents})
