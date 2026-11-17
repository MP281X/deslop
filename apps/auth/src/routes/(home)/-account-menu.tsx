import {AccountButton} from '@deslop/components-web/shell/app-bar'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'

import type {SignedAccount} from '#services/people/schema.ts'

export function AccountMenu(props: {account: SignedAccount}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<AccountButton account={props.account} />} />
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					<DropdownMenuItem disabled>{props.account.name}</DropdownMenuItem>
					{props.account.signOut && (
						<>
							{/* oxlint-disable-next-line @deslop/coding-standards/no-bare-control -- This menu form submits one action, with no fields to group. */}
							<form action="/sign-out" method="post">
								<DropdownMenuItem render={<button aria-label="Sign out" type="submit" />}>Sign out</DropdownMenuItem>
							</form>
						</>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
