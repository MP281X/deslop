import {useAtomValue} from '@effect/atom-react'

import {Option, String, pipe} from 'effect'

import {Button, Image, Label} from '@expo/ui/swift-ui'
import {AsyncResult} from 'effect/reactivity'
import {useColorScheme} from 'react-native'

import {assetAtom, menuIconAtom} from '#lib/utils.ts'
import type {NoteItem} from '#services/notes/schema.ts'
import {BrandImage, brands} from '@deslop/components/mobile/brand'

// The app a note's link opens in, when stash has its logo.
export function brandOf(note: NoteItem) {
	if (note.source === 'TikTok') return Option.some(brands.tiktok)
	if (note.source === 'X') return Option.some(brands.x)
	return pipe(
		Option.fromNullishOr(note.url),
		Option.flatMap(String.match(/^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\//u)),
		Option.map(() => brands.youtube)
	)
}

// The kinds of note the filter menu offers, in its order, with their symbols and, for apps, their logos.
export const kinds = [
	{brand: brands.tiktok, kind: 'tiktok', label: 'TikTok', symbol: 'play.rectangle'},
	{brand: brands.x, kind: 'x', label: 'X', symbol: 'xmark'},
	{brand: brands.youtube, kind: 'youtube', label: 'YouTube', symbol: 'play.tv'},
	{kind: 'web', label: 'Web', symbol: 'globe'},
	{kind: 'note', label: 'Notes', symbol: 'text.alignleft'},
	{kind: 'file', label: 'Photos and Videos', symbol: 'photo'}
] as const

export type Kind = (typeof kinds)[number]['kind']

export function kindOf(note: NoteItem): Kind {
	if (note.file !== undefined) return 'file'
	if (note.source === 'TikTok') return 'tiktok'
	if (note.source === 'X') return 'x'
	if (note.source === 'Note') return 'note'
	return Option.isSome(brandOf(note)) ? 'youtube' : 'web'
}

// The logo for the current appearance; nothing until its file is ready.
export function Brand(props: {brand: (typeof brands)[keyof typeof brands]; size: number}) {
	const uri = useAtomValue(assetAtom(useColorScheme() === 'dark' ? props.brand.dark : props.brand.light))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <BrandImage uri={uri.value} size={props.size} />
}

// A menu action with an app's logo shape as its icon when it has one, otherwise a symbol.
export function MenuAction(props: {
	brand: Option.Option<(typeof brands)[keyof typeof brands]>
	label: string
	onPress: () => void
	symbol: Parameters<typeof Button>[0]['systemImage']
}) {
	return Option.match(props.brand, {
		onNone: () => <Button label={props.label} systemImage={props.symbol} onPress={props.onPress} />,
		onSome: brand => (
			<Button onPress={props.onPress}>
				<Label title={props.label} icon={<MenuIcon module={brand.menu} />} />
			</Button>
		)
	})
}

// A kind of note as a menu row: the app's logo shape when it has one, otherwise its symbol. Modifiers such as a picker
// tag go on the label.
export function KindLabel(props: {entry: (typeof kinds)[number]; modifiers: Parameters<typeof Label>[0]['modifiers']}) {
	return 'brand' in props.entry ? (
		<Label title={props.entry.label} icon={<MenuIcon module={props.entry.brand.menu} />} modifiers={props.modifiers} />
	) : (
		<Label title={props.entry.label} systemImage={props.entry.symbol} modifiers={props.modifiers} />
	)
}

// The logo's shape for a menu row; nothing until its file is ready.
function MenuIcon(props: {module: number | string}) {
	const uri = useAtomValue(menuIconAtom(props.module))
	if (!AsyncResult.isSuccess(uri)) return undefined
	return <Image uiImage={uri.value} />
}
