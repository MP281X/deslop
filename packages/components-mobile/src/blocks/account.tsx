import {useAtomSet, useAtomValue} from '@effect/atom-react'

import {Function, Option, pipe} from 'effect'

import {Button, Image, Menu, Section} from '@expo/ui/swift-ui'
import {
	accessibilityLabel,
	buttonStyle,
	clipShape,
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
// judge-ignore no-silent-fallback -- The account identity comes from the session; its optional decorative picture can be replaced by a person symbol without claiming a downloaded photo.
function Avatar(props: {id: UserId}) {
	const picture = useAtomValue(avatarAtom(props.id))
	if (!AsyncResult.isSuccess(picture)) {
		return <Image systemName="person.crop.circle" modifiers={[frame({height: 28, width: 28})]} />
	}
	return (
		<Image uiImage={picture.value} modifiers={[resizable(), frame({height: 28, width: 28}), clipShape('circle')]} />
	)
}

// Signing out ends the session at Auth for every app; a tailnet device has none, so its menu only names it.
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
			<Section {...Option.match(account, {onNone: () => ({}), onSome: current => ({title: `@${current.name}`})})}>
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
			</Section>
		</Menu>
	)
}
