import {Function, Option} from 'effect'

import {Toolbar, ToolbarItem, useNativeState} from '@expo/ui/swift-ui'
import {navigationBarTitleDisplayMode, navigationTitle, searchable} from '@expo/ui/swift-ui/modifiers'
import type {ReactElement, ReactNode} from 'react'

import type {Session} from '@deslop/runtime/mobile/session'

import {AccountMenu} from '#components/blocks/account.tsx'
import {useListSearch} from '#components/blocks/list-detail.tsx'
import {bottomBarSearch} from '#lib/toolbar.ts'

// A list screen's bar, as every web bar: the small title in the navigation bar, a problem mark leading, the account trailing, and the search field in the bottom bar between the screen's `bottomBar` items; a menu opened from the bottom bar reverses its items unless its order is fixed.
export function ListToolbar(props: {
	bottomBar?: ReactNode
	children: ReactNode
	onSearch: (text: string) => void
	problem: Option.Option<ReactElement>
	session: Session
	title: string
}) {
	const own = useNativeState('')
	// Outside a `ListDetail`, the bar keeps its own.
	const query = Option.getOrElse(useListSearch(), () => own)
	return (
		<Toolbar
			modifiers={[
				navigationTitle(props.title),
				navigationBarTitleDisplayMode('inline'),
				searchable(query, {onChange: props.onSearch, prompt: 'Search'}),
				bottomBarSearch
			]}
		>
			{props.children}
			<Toolbar.Content>
				{Option.match(props.problem, {
					onNone: Function.constNull,
					onSome: problem => <ToolbarItem placement="topBarLeading">{problem}</ToolbarItem>
				})}
				<ToolbarItem placement="topBarTrailing">
					<AccountMenu session={props.session} />
				</ToolbarItem>
				{props.bottomBar}
			</Toolbar.Content>
		</Toolbar>
	)
}
