import {Array, Boolean, Cause, DateTime, Option, Schema, pipe} from 'effect'

import {Button, HStack, Image, Text} from '@expo/ui/swift-ui'
import {accessibilityElement, buttonStyle, foregroundStyle, lineLimit} from '@expo/ui/swift-ui/modifiers'
import type {ViewModifier} from '@expo/ui/swift-ui/modifiers'

import {BrandLogo} from '@deslop/components-mobile/icons'
import {colors, space, text} from '@deslop/components-mobile/theme'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-mobile/ui/item'

import {kindOf, kinds, siteOf} from '#lib/utils.ts'
import type {Kind, NoteItem} from '#services/notes/schema.ts'
import {Brand} from '#services/notes/schema.ts'

export function ReadError(props: {
	cause: Cause.Cause<unknown>
	modifiers?: ViewModifier[]
	onRetry: () => void
	title: string
}) {
	return (
		<Item modifiers={props.modifiers}>
			<ItemMedia>
				<Image systemName="exclamationmark.triangle" modifiers={[foregroundStyle(colors.destructive)]} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle modifiers={[foregroundStyle(colors.destructive)]}>{props.title}</ItemTitle>
				<ItemDescription modifiers={[lineLimit(3)]}>
					{Option.getOrElse(
						Option.map(Array.head(Cause.prettyErrors(props.cause)), error => error.message),
						() => Cause.pretty(props.cause)
					)}
				</ItemDescription>
			</ItemContent>
			<ItemActions>
				<Button label="Try Again" onPress={props.onRetry} modifiers={[buttonStyle('glass')]} />
			</ItemActions>
		</Item>
	)
}

// "23 Oct" this year, "23 Oct 2025" before it.
function savedOn(createdAt: number) {
	const saved = DateTime.makeUnsafe(createdAt)
	return DateTime.formatLocal(
		saved,
		Boolean.match(DateTime.getPartUtc(saved, 'year') === DateTime.getPartUtc(DateTime.nowUnsafe(), 'year'), {
			onFalse: () => ({day: 'numeric', month: 'short', year: 'numeric'}) as const,
			onTrue: () => ({day: 'numeric', month: 'short'}) as const
		})
	)
}

function SourceIcon(props: {kind: Kind}) {
	if (Schema.is(Brand)(props.kind)) return <BrandLogo brand={kinds[props.kind].logo} size={12} />
	return <Image systemName={kinds[props.kind].symbol} size={11} modifiers={[foregroundStyle(colors.mutedForeground)]} />
}

// The source's logo, who made the entry or the site it is on, and when it was saved.
export function Byline(props: {note: NoteItem}) {
	return (
		<HStack spacing={space[1]} modifiers={[accessibilityElement('combine')]}>
			<SourceIcon kind={kindOf(props.note)} />
			<Text modifiers={[text.caption, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
				{pipe(
					[
						Option.orElse(Option.fromUndefinedOr(props.note.author), () => siteOf(props.note)),
						Option.some(savedOn(props.note.createdAt))
					],
					Array.getSomes,
					Array.join(' · ')
				)}
			</Text>
		</HStack>
	)
}
