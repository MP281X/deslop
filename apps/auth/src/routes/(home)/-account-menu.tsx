import {AccountButton} from '@deslop/components-web/shell/app-bar'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'

import type {SignedAccount} from '#services/people/schema.ts'

// The shared app menu's label and sign-out, posting to Auth's own route; a tailnet caller has no session to end, so no sign-out.
export function AccountMenu(props: {account: SignedAccount}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<AccountButton account={props.account} />} />
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuGroup>
					<DropdownMenuLabel>@{props.account.name}</DropdownMenuLabel>
				</DropdownMenuGroup>
				{props.account.signOut && (
					<>
						<DropdownMenuSeparator />
						<form action="/sign-out" method="post">
							<DropdownMenuItem variant="destructive" render={<button aria-label="Sign out" type="submit" />}>
								Sign out
							</DropdownMenuItem>
						</form>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
