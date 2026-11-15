import {useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Match, Number, Option, pipe} from 'effect'

import {Circle, HStack, Image, TabView, VStack} from '@expo/ui/swift-ui'
import {
	accessibilityHidden,
	accessibilityLabel,
	aspectRatio,
	foregroundStyle,
	frame,
	resizable,
	tabViewStyle
} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {colors, space} from '@deslop/components-mobile/theme'
import {Skeleton} from '@deslop/components-mobile/ui/skeleton'

import {imageAtom, mediaAtom, mediaImageAtom} from '#lib/notes.ts'
import type {Page} from '#lib/pages.ts'
import {pagesOf} from '#lib/pages.ts'
import type {NoteItem} from '#services/notes/schema.ts'

// A fixed slot, so the title stays put while the pictures load or when they cannot.
const slot = [frame({height: 320}), frame({maxWidth: Infinity})]

function Picture(props: {atom: ReturnType<typeof imageAtom>}) {
	const image = useAtomValue(props.atom)
	if (AsyncResult.isFailure(image)) return <VStack modifiers={slot}>{null}</VStack>
	if (!AsyncResult.isSuccess(image)) return <Skeleton modifiers={slot} />
	return (
		<Image
			uiImage={image.value}
			modifiers={[resizable(), aspectRatio({contentMode: 'fit'}), ...slot, accessibilityHidden(true)]}
		/>
	)
}

function PageView(props: {note: NoteItem; page: Page}) {
	return pipe(
		Match.value(props.page.kind),
		Match.when('cover', () => <Picture atom={imageAtom(props.note.id)} />),
		Match.when('image', () => <Picture atom={mediaImageAtom(props.page.path)} />),
		Match.exhaustive
	)
}

// The post's pictures: one swipeable pager with its dots below, and no dots for a single page.
export function Pager(props: {note: NoteItem}) {
	const media = useAtomValue(mediaAtom(props.note.id))
	const [selected, setSelected] = useState(0)
	const pages = pagesOf(
		Option.isSome(props.note.image),
		props.note.id,
		Option.getOrElse(AsyncResult.value(media), Function.constant(0))
	)
	if (!Array.isReadonlyArrayNonEmpty(pages)) return undefined
	if (pages.length === 1) return <PageView note={props.note} page={Array.headNonEmpty(pages)} />
	return (
		<VStack spacing={space[2]}>
			<TabView
				selection={`${selected}`}
				onSelectionChange={value => Option.map(Number.parse(value), setSelected)}
				modifiers={[tabViewStyle({indexDisplayMode: 'never', type: 'page'}), ...slot]}
			>
				{Array.map(pages, (page, index) => (
					<TabView.Tab key={page.path} value={`${index}`}>
						<PageView note={props.note} page={page} />
					</TabView.Tab>
				))}
			</TabView>
			<HStack spacing={space[2]} modifiers={[accessibilityLabel(`Page ${selected + 1} of ${pages.length}`)]}>
				{Array.map(pages, (page, index) => (
					<Circle
						key={page.path}
						modifiers={[
							frame({height: 7, width: 7}),
							foregroundStyle(
								Boolean.match(index === selected, {
									onFalse: () => colors.mutedForeground,
									onTrue: () => colors.foreground
								})
							)
						]}
					/>
				))}
			</HStack>
		</VStack>
	)
}
