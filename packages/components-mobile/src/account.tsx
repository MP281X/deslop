import {useAtomSet} from '@effect/atom-react'

import {Button, Menu} from '@expo/ui/swift-ui'
import {labelStyle, tint} from '@expo/ui/swift-ui/modifiers'

import type {Session} from '@deslop/runtime/mobile/session'

import {colors} from '#components/theme.ts'

// The account in the navigation bar, as in the web app bar; signing out also ends this app's sign-in at Auth.
export function AccountMenu(props: {session: Session}) {
	const send = useAtomSet(props.session.send)
	return (
		<Menu
			label="Account"
			systemImage="person.crop.circle"
			modifiers={[labelStyle('iconOnly'), tint(colors.mutedForeground)]}
		>
			<Button
				label="Sign Out"
				systemImage="rectangle.portrait.and.arrow.right"
				role="destructive"
				onPress={() => send({_tag: 'SignOut'})}
			/>
		</Menu>
	)
}
