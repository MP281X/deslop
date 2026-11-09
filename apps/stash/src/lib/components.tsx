import {Array, Boolean, DateTime, Match, Option, Schema, pipe} from 'effect'

import {HStack, Image} from '@expo/ui/swift-ui'
import {accessibilityElement, accessibilityHidden, foregroundStyle} from '@expo/ui/swift-ui/modifiers'

import {BrandLogo} from '@deslop/components-mobile/icons'
import {colors, space} from '@deslop/components-mobile/theme'
import {ItemAnnotation} from '@deslop/components-mobile/ui/item'

import {kindOf, kinds, siteOf} from '#lib/utils.ts'
import type {Kind, NoteItem} from '#services/notes/schema.ts'
import {Brand} from '#services/notes/schema.ts'

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

// The source mark is decoration; the byline's text names the source.
function SourceIcon(props: {kind: Kind}) {
	return (
		<HStack modifiers={[accessibilityHidden(true)]}>
			{pipe(
				Match.value(props.kind),
				Match.when(Schema.is(Brand), kind => <BrandLogo brand={kinds[kind].logo} size={12} />),
				Match.orElse(kind => (
					<Image systemName={kinds[kind].symbol} size={11} modifiers={[foregroundStyle(colors.mutedForeground)]} />
				))
			)}
		</HStack>
	)
}

// The source's logo, who made the entry or the site it is on, and when it was saved.
export function Byline(props: {note: NoteItem}) {
	return (
		<HStack spacing={space[1]} modifiers={[accessibilityElement('combine')]}>
			<SourceIcon kind={kindOf(props.note)} />
			<ItemAnnotation>
				{pipe(
					[
						Option.orElse(Option.fromUndefinedOr(props.note.author), () => siteOf(props.note)),
						Option.some(savedOn(props.note.createdAt))
					],
					Array.getSomes,
					Array.join(' · ')
				)}
			</ItemAnnotation>
		</HStack>
	)
}
