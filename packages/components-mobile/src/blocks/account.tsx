import {useAtomValue} from '@effect/atom-react'

import {Function, Option} from 'effect'

import {Image, Menu, Text} from '@expo/ui/swift-ui'
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
function Avatar(props: {id: UserId}) {
	const picture = useAtomValue(avatarAtom(props.id))
	if (!AsyncResult.isSuccess(picture)) {
		return <Image systemName="person.crop.circle" modifiers={[frame({height: 28, width: 28})]} />
	}
	return (
		<Image uiImage={picture.value} modifiers={[resizable(), frame({height: 28, width: 28}), clipShape('circle')]} />
	)
}

export function AccountMenu(props: {session: Session}) {
	const account = AsyncResult.value(useAtomValue(props.session.account))
	return (
		<Menu
			label={Option.match(account, {
				onNone: () => <Image systemName="person.crop.circle" modifiers={[frame({height: 28, width: 28})]} />,
				onSome: current => <Avatar id={current.id} />
			})}
			modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), accessibilityLabel('Account')]}
		>
			<Text>{Option.match(account, {onNone: Function.constant(''), onSome: current => `@${current.name}`})}</Text>
		</Menu>
	)
}
