import {Array, Boolean, DateTime, Match, Option, Schema, pipe} from 'effect'

import {HStack, Image, Text} from '@expo/ui/swift-ui'
import {accessibilityElement, accessibilityHidden, foregroundStyle, lineLimit} from '@expo/ui/swift-ui/modifiers'

import {BrandLogo} from '@deslop/components-mobile/icons'
import {colors, space, text} from '@deslop/components-mobile/theme'

import {kindOf, kinds, siteOf} from '#lib/utils.ts'
import type {Kind, NoteItem} from '#services/notes/schema.ts'
import {Brand} from '#services/notes/schema.ts'

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
