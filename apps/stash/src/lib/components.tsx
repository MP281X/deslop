import {Array, DateTime, Match, Option, Schema, pipe} from 'effect'

import {HStack, Image, Text} from '@expo/ui/swift-ui'
import {accessibilityElement, accessibilityHidden, foregroundStyle, lineLimit} from '@expo/ui/swift-ui/modifiers'

import {shortDate} from '@deslop/components-mobile/dates'
import {colors, space, text} from '@deslop/components-mobile/theme'

import {BrandLogo} from '#lib/icons.tsx'
import {kindOf, kinds, siteOf} from '#lib/kinds.ts'
import type {Kind, NoteItem} from '#services/notes/schema.ts'
import {Brand} from '#services/notes/schema.ts'

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
						Option.orElse(props.note.author, () => siteOf(props.note)),
						Option.some(shortDate(DateTime.toEpochMillis(props.note.createdAt)))
					],
					Array.getSomes,
					Array.join(' · ')
				)}
			</Text>
		</HStack>
	)
}
