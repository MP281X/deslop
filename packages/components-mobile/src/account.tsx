import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Option} from 'effect'

import {Button, Image, Menu, Section} from '@expo/ui/swift-ui'
import {accessibilityLabel, buttonStyle, frame, menuIndicator, menuStyle, resizable} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import type {Session} from '@deslop/runtime/mobile/session'

import {avatarAtom} from '#lib/images.ts'

// Square, like the web's avatar: the picture and its fallback both fill the same 28pt tile.
function Avatar(props: {id: string}) {
	const picture = useAtomValue(avatarAtom(props.id))
	if (!AsyncResult.isSuccess(picture)) {
		return <Image systemName="person.crop.square" modifiers={[frame({height: 28, width: 28})]} />
	}
	return <Image uiImage={picture.value} modifiers={[resizable(), frame({height: 28, width: 28})]} />
}

// Signing out also ends this app's sign-in at Auth, as in the web app bar.
export function AccountMenu(props: {session: Session}) {
	const send = useAtomSet(props.session.machine.send)
	const account = AsyncResult.value(useAtomValue(props.session.account))
	return (
		<Menu
			label={Option.match(account, {
				onNone: () => <Image systemName="person.crop.square" modifiers={[frame({height: 28, width: 28})]} />,
				onSome: current => <Avatar id={current.id} />
			})}
			modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), accessibilityLabel('Account')]}
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
