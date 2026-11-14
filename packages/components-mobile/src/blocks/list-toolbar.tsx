import {Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {navigationBarTitleDisplayMode, navigationTitle, searchable} from '@expo/ui/swift-ui/modifiers'
import type {ReactElement, ReactNode} from 'react'

import type {Session} from '@deslop/runtime/mobile/session'

import {AccountMenu} from '#components/blocks/account.tsx'
import {bottomBarSearch} from '#lib/toolbar.ts'

// A list screen's bar, as every web bar: the large title, a problem mark leading, the account trailing, and the search field in the bottom bar between the screen's `bottomBar` items; a menu opened from the bottom bar reverses its items unless its order is fixed.
export function ListToolbar(props: {
	bottomBar?: ReactNode
	children: ReactNode
	onSearch: (text: string) => void
	problem?: ReactElement
	prompt?: string
	session: Session
	title: string
}) {
	const query = useNativeState('')
	return (
		<Toolbar
			modifiers={[
				navigationTitle(props.title),
				navigationBarTitleDisplayMode('large'),
				searchable(query, {onChange: props.onSearch, prompt: props.prompt ?? 'Search'}),
				bottomBarSearch
			]}
		>
			{props.children}
			<Toolbar.Content>
				{props.problem !== undefined && <ToolbarItem placement="topBarLeading">{props.problem}</ToolbarItem>}
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={props.session} />
				</ToolbarItem>
				{props.bottomBar}
			</Toolbar.Content>
		</Toolbar>
	)
}
