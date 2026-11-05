import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {KeyRound} from 'lucide-react'
import {Suspense} from 'react'

import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@deslop/components-web/ui/table'

import {ageLabel, appsAtom, dayLabel, minuteAtom, minutesSince, revokeAgentAtom} from '#lib/utils.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'

// "never" until its first call, then relative while it is recent, as the sign-ins grid names activity.
function usedLabel(app: SignedInApp, now: number) {
	if (app.lastActive === app.createdAt) return 'never'
	const minutes = minutesSince(app.lastActive, now)
	if (minutes < 1) return 'now'
	return `${ageLabel(minutes)} ago`
}

// One line per token: the machine that made it, when, and when it was last used; Revoke in its row, and its context menu.
function AgentRow(props: {app: SignedInApp; now: number}) {
	const [revoking, revoke] = useAtom(revokeAgentAtom)
	const name = Option.getOrElse(Option.fromUndefinedOr(props.app.agent), () => props.app.device)
	const used = usedLabel(props.app, props.now)
	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<TableRow tabIndex={0} aria-haspopup="menu" aria-label={`${name}, last used ${used}`} />}
			>
				<TableCell>
					<span className="flex min-w-0 items-center gap-2">
						<KeyRound className="text-muted-foreground size-3.5 shrink-0" />
						<span className="min-w-0 truncate font-medium">{name}</span>
					</span>
				</TableCell>
				<TableCell className="text-muted-foreground font-mono max-sm:hidden">{dayLabel(props.app.createdAt)}</TableCell>
				<TableCell className="text-muted-foreground font-mono">{used}</TableCell>
				<TableCell className="text-right">
					<Button
						variant="destructive"
						size="sm"
						disabled={AsyncResult.isWaiting(revoking)}
						onClick={() => revoke(props.app.family)}
					>
						Revoke
					</Button>
				</TableCell>
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

// Every token agents made for themselves, newest use first, as the apps stream sorts it.
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
						<EmptyDescription>An agent gets one by running the command above.</EmptyDescription>
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
							<TableHead className="text-right">Revoke</TableHead>
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

// The command an agent runs is the only way a token is made; this page lists what agents have made.
function Agents() {
	return (
		<div className="mx-auto flex w-full max-w-xl flex-col gap-4">
			<p className="text-muted-foreground text-sm">
				An agent runs{' '}
				<code className="bg-muted rounded-sm px-1 py-0.5 font-mono text-xs">
					curl -fsSL https://auth.mp281x.xyz/agent | sh
				</code>{' '}
				and you approve it here.
			</p>
			<Suspense fallback={<ItemListSkeleton label="Agent tokens" media rows={2} />}>
				<AgentList />
			</Suspense>
		</div>
	)
}

export const Route = createFileRoute('/(home)/agents')({component: Agents})
