import {useAtom, useAtomMount, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Option} from 'effect'

import {KeyIcon} from '@phosphor-icons/react'
import {getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'

import {AccountAvatar} from '@deslop/components-web/app-bar'
import {Button} from '@deslop/components-web/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'

import {
	accountMenuOpenAtom,
	addPasskeyAtom,
	confirmForPasskeyAtom,
	menuSignOutAtom,
	passkeysAtom,
	resumePasskeyAtom
} from '#lib/auth.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import type {SessionVia} from '#services/tokens/schema.ts'

const route = getRouteApi('/(home)')

// A failed menu action says so directly under it, as the menu already reports an unreadable passkey list.
function MenuFailure(props: {message: string}) {
	return (
		<DropdownMenuItem disabled variant="destructive">
			{props.message}
		</DropdownMenuItem>
	)
}

function PasskeyItems(props: {via: SessionVia}) {
	const read = useAtomValue(passkeysAtom)
	const passkeys = AsyncResult.getOrElse(read, () => [])
	const [adding, add] = useAtom(addPasskeyAtom)
	const [confirming, confirm] = useAtom(confirmForPasskeyAtom)
	return (
		<DropdownMenuGroup>
			{/* A failed read says so, rather than looking like an account without passkeys. */}
			{Option.match(AsyncResult.error(read), {
				onNone: Function.constNull,
				onSome: failure => <MenuFailure message={`Passkeys unavailable · ${failure.message}`} />
			})}
			{Array.map(passkeys, passkey => (
				<DropdownMenuItem key={passkey.id} disabled>
					<KeyIcon />
					<span className="truncate">{passkey.addedFrom}</span>
					<span className="text-muted-foreground ml-auto pl-3 text-xs">
						{Boolean.match(passkey.synced, {
							onFalse: Function.constant('One device'),
							onTrue: Function.constant('Synced')
						})}
					</span>
				</DropdownMenuItem>
			))}
			{/* A code may have been approved for someone else's browser, so a code session passes through GitHub before it adds a year-long passkey. */}
			<DropdownMenuItem
				closeOnClick={false}
				disabled={AsyncResult.isWaiting(adding) || AsyncResult.isWaiting(confirming)}
				onClick={() => Boolean.match(props.via === 'Code', {onFalse: () => add(), onTrue: () => confirm()})}
			>
				<KeyIcon />
				Add a passkey
			</DropdownMenuItem>
			{Option.match(AsyncResult.error(adding), {
				onNone: Function.constNull,
				onSome: failure => <MenuFailure message={failure.message} />
			})}
		</DropdownMenuGroup>
	)
}

export function AccountMenu(props: {account: SignedAccount}) {
	const next = route.useSearch({select: search => search.next})
	const [signOut, endSession] = useAtom(menuSignOutAtom)
	const [open, setOpen] = useAtom(accountMenuOpenAtom)
	useAtomMount(resumePasskeyAtom(props.account.via))
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger aria-label="Account" render={<Button variant="ghost" size="icon-sm" />}>
				<AccountAvatar account={props.account} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						<span className="text-foreground">{`@${props.account.name}`}</span>
						{props.account.role === 'Admin' && <span className="text-muted-foreground"> admin</span>}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				{props.account.role !== 'Waiting' && <PasskeyItems via={props.account.via} />}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					closeOnClick={false}
					disabled={AsyncResult.isWaiting(signOut)}
					onClick={() => endSession(next)}
				>
					Sign out
				</DropdownMenuItem>
				{Option.match(AsyncResult.error(signOut), {
					onNone: Function.constNull,
					onSome: failure => <MenuFailure message={failure.message} />
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
