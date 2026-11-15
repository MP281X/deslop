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
						<DropdownMenuItem
							onClick={() => location.assign(`/sign-out?${new URLSearchParams({next: location.origin})}`)}
						>
							Sign out
						</DropdownMenuItem>
					)}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
