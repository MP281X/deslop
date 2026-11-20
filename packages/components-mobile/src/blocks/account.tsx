import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Function, Option, pipe} from 'effect'

import {Button, Image, Menu} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	buttonStyle,
	clipShape,
	disabled,
	frame,
	menuIndicator,
	menuStyle,
	resizable
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'

import type {Session} from '@deslop/runtime/mobile/session'
import type {UserId} from '@deslop/runtime/shared/auth'

import {avatarAtom} from '#lib/images.ts'

// A circle, like the web's avatar: the picture and its fallback both fill the same 28pt disc.
function Avatar(props: {id: UserId}) {
	const picture = useAtomValue(avatarAtom(props.id))
	if (!AsyncResult.isSuccess(picture)) {
		return <Image systemName="person.crop.circle" modifiers={[frame({height: 28, width: 28})]} />
	}
	return Option.match(picture.value, {
		onNone: () => <Image systemName="person.crop.circle" modifiers={[frame({height: 28, width: 28})]} />,
		onSome: uri => (
			<Image uiImage={uri} modifiers={[resizable(), frame({height: 28, width: 28}), clipShape('circle')]} />
		)
	})
}

// Signing out ends the session at Auth for every app; a tailnet device has none, so its menu is the greyed name alone.
// judge-ignore no-silent-fallback -- SessionGate owns account failures and unmounts its children for them; this menu only presents that admitted account and never invents an identity.
export function AccountMenu(props: {session: Session}) {
	const signOut = useAtomSet(props.session.signOut)
	const account = AsyncResult.value(useAtomValue(props.session.account))
	return (
		<Menu
			label={Option.match(account, {
				onNone: () => <Image systemName="person.crop.circle" modifiers={[frame({height: 28, width: 28})]} />,
				onSome: current => <Avatar id={current.id} />
			})}
			modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), accessibilityLabel('Account')]}
		>
			{Option.match(account, {
				onNone: Function.constNull,
				onSome: current => <Button label={`@${current.name}`} modifiers={[disabled(true)]} />
			})}
			{pipe(
				account,
				Option.filter(current => current.signOut),
				Option.match({
					onNone: Function.constNull,
					onSome: () => (
						<Button
							label="Sign Out"
							systemImage="rectangle.portrait.and.arrow.right"
							role="destructive"
							onPress={() => signOut()}
						/>
					)
				})
			)}
		</Menu>
	)
}
