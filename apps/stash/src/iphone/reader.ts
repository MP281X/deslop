import type {Native} from '@effect/ui-native'
import type {Markdown} from '@effect/ui/html'

import {Array, Boolean, Function, Match, Option, Result, String} from 'effect'

import {Row, status, styles} from '@deslop/components/native'

import {Button} from '#iphone/controls.ts'
import {Gallery} from '#iphone/gallery.ts'
import {isWebLink, parseBody} from '#screens/note.ts'
import type {Reader, StashMessage, StashScreen} from '#screens/notes.ts'
import {openLink, retry} from '#screens/notes.ts'

type H = Native.H<StashMessage>
type Content = Exclude<Native.NoTextInput<StashMessage>, readonly unknown[]>
type Inline = Native.TextElement<StashMessage, never, Native.TextEvents, 'text'> | string

function inline(h: H, nodes: readonly Markdown.Inline[]): readonly Inline[] {
	return Array.map(nodes, item =>
		Match.valueTags(item, {
			Emphasis: node => h.text.style({fontStyle: 'italic'}).children(inline(h, node.content)),
			HardBreak: Function.constant('\n'),
			Image: node => node.alt,
			InlineCode: node => h.text.style({fontFamily: 'ui-monospace'}).children(node.value),
			Link: node => {
				const text = h.text.children(inline(h, node.content))
				if (!isWebLink(node.url)) return text
				return text
					.prop('accessibilityRole', 'link')
					.style({textDecorationLine: 'underline'})
					.on('press', openLink(node.url))
			},
			Strikethrough: node => h.text.style({textDecorationLine: 'line-through'}).children(inline(h, node.content)),
			Strong: node => h.text.style({fontWeight: '600'}).children(inline(h, node.content)),
			Text: node => node.value
		})
	)
}

function table(h: H, node: Markdown.Table, key: string) {
	return h.view
		.key(key)
		.style({gap: 6})
		.children(
			Array.map([node.headerRow, ...node.bodyRows], (row, rowIndex) =>
				h.view
					.key(`${rowIndex}`)
					.style({flexDirection: 'row', gap: 8})
					.children(
						Array.map(row.cells, (cell, column) =>
							h.text
								.key(`${column}`)
								.style({
									...styles.body,
									flex: 1,
									fontWeight: Boolean.match(rowIndex === 0, {
										onFalse: Function.constant('400' as const),
										onTrue: Function.constant('600' as const)
									})
								})
								.children(inline(h, cell.content))
						)
					)
			)
		)
}

function blocks(h: H, nodes: readonly Markdown.Block[]): readonly Content[] {
	function nested(content: readonly Markdown.Block[], key: string) {
		return h.view.key(key).style({gap: 8, paddingLeft: 12}).children(blocks(h, content))
	}

	function list(node: Markdown.List, key: string) {
		return h.view
			.key(key)
			.style({gap: 8})
			.children(
				Array.map(node.items, (item, position) =>
					h.view
						.key(`${position}`)
						.style({flexDirection: 'row', gap: 8})
						.children(
							h.text
								.style(styles.line)
								.children(
									Boolean.match(node.isOrdered, {
										onFalse: Function.constant('•'),
										onTrue: () => `${Option.getOrElse(node.startNumber, Function.constant(1)) + position}.`
									})
								),
							h.view.style({flex: 1, gap: 6}).children(blocks(h, item.blocks))
						)
				)
			)
	}
	return Array.map(nodes, (item, index) => {
		const key = `${index}`
		return Match.valueTags(item, {
			Blockquote: node => nested(node.blocks, key),
			CodeBlock: node =>
				h.text
					.key(key)
					.style({...styles.body, fontFamily: 'ui-monospace'})
					.prop('selectable', true)
					.children(node.value),
			Heading: node => h.text.key(key).style(styles.heading).children(inline(h, node.content)),
			Island: node => nested(node.blocks, key),
			List: node => list(node, key),
			Paragraph: node => h.text.key(key).style(styles.body).prop('selectable', true).children(inline(h, node.content)),
			Table: node => table(h, node, key),
			ThematicBreak: () => h.view.key(key).style({height: 8})
		})
	})
}

function body(h: H, raw: string) {
	return Result.match(parseBody(raw), {
		onFailure: () => h.text.style(styles.body).prop('selectable', true).children(raw),
		onSuccess: document => h.view.style({gap: 12}).children(blocks(h, document.blocks))
	})
}

export function Skeleton(h: Native.H<StashMessage>) {
	return h.view
		.prop('accessibilityLabel', 'Loading note')
		.style({gap: 12})
		.children(
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 19, width: '60%'}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 12, width: '86%'}),
			h.view.style({backgroundColor: '#202020', borderRadius: 4, height: 12, width: '69%'})
		)
}

function problem(h: H, text: string, failed: boolean, retryable = false) {
	return h.view
		.style({alignItems: 'center', flexDirection: 'row', gap: 8})
		.children(
			failed && h.view.style({...styles.dot, backgroundColor: status.error}),
			h.text.style({...styles.line, flexShrink: 1}).children(text),
			retryable && Button(h, 'Retry', retry)
		)
}

export function ReaderView(h: Native.H<StashMessage>, screen: StashScreen, note: Reader) {
	if (note.denied) return h.text.style(styles.line).children('Access denied')
	return h.view
		.key(note.id)
		.style({gap: 12})
		.children(
			h.text.style(styles.heading).prop('accessibilityRole', 'header').children(note.title),
			h.view
				.style({flexDirection: 'row', gap: 10, justifyContent: 'space-between'})
				.children(
					h.text.style({...styles.line, flexShrink: 1}).children(note.source),
					h.text.style({...styles.line, fontVariant: ['tabular-nums']}).children(note.saved)
				),
			Array.isReadonlyArrayNonEmpty(note.pictures) && Gallery(h, {key: note.id, props: {paths: note.pictures}}),
			note.status !== undefined && problem(h, note.status, note.statusFailed),
			String.isNonEmpty(note.summary) &&
				h.text
					.style({...styles.body, color: styles.line.color})
					.prop('selectable', true)
					.children(note.summary),
			Array.isReadonlyArrayNonEmpty(note.tags) &&
				h.view
					.style({flexDirection: 'row', flexWrap: 'wrap', gap: 6})
					.children(
						Array.map(note.tags, entry =>
							Button(h, `${entry.tag}  ${entry.count}`, screen.filter(entry.tag), {
								compact: true,
								selected: screen.tag === entry.tag
							}).key(entry.tag)
						)
					),
			note.body !== undefined && body(h, note.body),
			note.loading && Skeleton(h),
			note.retry !== undefined && problem(h, note.retry, true, true),
			!note.loading &&
				Array.isReadonlyArrayNonEmpty(note.related) &&
				h.view.style({marginTop: 12}).children(
					h.text.style(styles.line).children('Related notes'),
					Array.map(note.related, item =>
						Row<StashMessage, never>(h, {active: false, item, select: screen.selection.select})
					)
				)
		)
}
