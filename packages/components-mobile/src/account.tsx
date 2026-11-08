import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Option} from 'effect'

import {Button, Image, Menu, Section} from '@expo/ui/swift-ui'
import {accessibilityLabel, clipShape, frame, labelStyle, resizable, tint} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import type {AppSession} from '@deslop/runtime/mobile/session'

import {colors} from '#components/theme.ts'
import {avatarAtom} from '#lib/utils.ts'

function Avatar(props: {id: string}) {
	const picture = useAtomValue(avatarAtom(props.id))
	if (!AsyncResult.isSuccess(picture)) return <Image systemName="person.crop.circle" />
	return (
		<Image uiImage={picture.value} modifiers={[resizable(), frame({height: 28, width: 28}), clipShape('circle')]} />
	)
}

// The account in the navigation bar, as in the web app bar: its GitHub picture, and its handle above Sign Out. Signing out also ends this app's sign-in at Auth.
export function AccountMenu(props: {session: AppSession}) {
	const send = useAtomSet(props.session.machine.send)
	const account = AsyncResult.value(useAtomValue(props.session.account))
	return (
		<Menu
			label={Option.match(account, {onNone: () => 'Account', onSome: current => <Avatar id={current.id} />})}
			systemImage="person.crop.circle"
			modifiers={[labelStyle('iconOnly'), tint(colors.mutedForeground), accessibilityLabel('Account')]}
		>
			<Section title={Option.match(account, {onNone: () => undefined, onSome: current => `@${current.name}`})}>
				<Button
					label="Sign Out"
					systemImage="rectangle.portrait.and.arrow.right"
					role="destructive"
					onPress={() => send({_tag: 'SignOut'})}
				/>
			</Section>
		</Menu>
	)
}
