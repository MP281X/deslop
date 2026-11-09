import {useAtom, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {KeyIcon} from '@phosphor-icons/react'
import {getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {useEffect} from 'react'

import {Button} from '@deslop/components-web/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'

import {AccountAvatar} from '#lib/components.tsx'
import {
	ADDING_PASSKEY,
	addPasskeyAtom,
	confirmForPasskeyAtom,
	menuSignOutAtom,
	passkeysAtom,
	removePasskeyAtom
} from '#lib/utils.ts'
import type {SignedAccount} from '#services/people/schema.ts'
import type {SessionVia} from '#services/tokens/schema.ts'

const route = getRouteApi('/(home)')

function PasskeyItems(props: {via: SessionVia}) {
	const read = useAtomValue(passkeysAtom)
	const passkeys = AsyncResult.getOrElse(read, () => [])
	const [adding, add] = useAtom(addPasskeyAtom)
	const [removing, remove] = useAtom(removePasskeyAtom)
	const [confirming, confirm] = useAtom(confirmForPasskeyAtom)
	return (
		<DropdownMenuGroup>
			{/* A failed read says so, rather than looking like an account without passkeys. */}
			{Option.match(AsyncResult.error(read), {
				onNone: () => null,
				onSome: failure => (
					<DropdownMenuItem disabled className="max-sm:h-11">
						<span className="text-destructive text-xs">Passkeys unavailable · {failure.message}</span>
					</DropdownMenuItem>
				)
			})}
			{Array.map(passkeys, passkey => (
				<DropdownMenuSub key={passkey.id}>
					<DropdownMenuSubTrigger>
						<KeyIcon />
						<span className="truncate">{passkey.addedFrom}</span>
						<span className="text-muted-foreground ml-auto pl-3 text-xs">
							{Boolean.match(passkey.synced, {onFalse: () => 'One device', onTrue: () => 'Synced'})}
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuItem
							variant="destructive"
							className="max-sm:h-11"
							disabled={AsyncResult.isWaiting(removing)}
							onClick={() => remove(passkey.id)}
						>
							Remove
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			))}
			{/* A code may have been approved for someone else's browser, so a code session passes through GitHub before it adds a year-long passkey. */}
			<DropdownMenuItem
				className="max-sm:h-11"
				disabled={AsyncResult.isWaiting(adding) || AsyncResult.isWaiting(confirming)}
				onClick={() => Boolean.match(props.via === 'Code', {onFalse: () => add(), onTrue: () => confirm()})}
			>
				<KeyIcon />
				Add a passkey
			</DropdownMenuItem>
		</DropdownMenuGroup>
	)
}

export function AccountMenu(props: {account: SignedAccount}) {
	const next = route.useSearch({select: search => search.next})
	const [signOut, endSession] = useAtom(menuSignOutAtom)
	const add = useAtomSet(addPasskeyAtom)
	// Back from GitHub, the passkey it went for starts at once, and only once.
	useEffect(() => {
		if (sessionStorage.getItem(ADDING_PASSKEY) === null) return
		sessionStorage.removeItem(ADDING_PASSKEY)
		if (props.account.via !== 'Code') add()
	}, [add, props.account.via])
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Account"
				render={<Button variant="ghost" size="icon" className="max-sm:size-11" />}
			>
				<AccountAvatar id={props.account.id} name={props.account.name} />
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
					className="max-sm:h-11"
					disabled={AsyncResult.isWaiting(signOut)}
					onClick={() => endSession(next)}
				>
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
