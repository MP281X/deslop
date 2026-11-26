import {Command, Component, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'
import {Html, HtmlCommand, HtmlSubscription} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Layer, Number, Predicate, Schema, Stream, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {Color, MoveVisitor, Scene, VisitorId, Visitors} from '#contracts'
import type {Visitor} from '#contracts'

import {ReadingSections, SectionName, sectionTargets} from '#web/home/sections.ts'
import {ownColorAtom, ownCursorAtom, recolorAtom, sceneAtom, sendCursorAtom} from '#web/presence/client.ts'
import {trailCells} from '#web/presence/trails.ts'
import {profile} from '#web/profile/content.ts'
import {Icon} from '#web/profile/icons.ts'

type Viewport = typeof Viewport.Type
const Viewport = Schema.Struct({height: Schema.Finite, width: Schema.Finite})
const SceneRead = AsyncResult.Schema({
	error: Schema.Unknown,
	success: Schema.Struct({...Scene.fields, trails: Visitors})
})

type Model = typeof Model.Type
const Model = Schema.Struct({
	color: Color,
	cursor: MoveVisitor,
	scene: SceneRead,
	shortcutsOpen: Schema.Boolean,
	viewport: Viewport
})

const Message = UiSchema.TaggedEnum({
	ColorChanged: {color: Color},
	CursorMoved: {cursor: MoveVisitor},
	JumpedToSection: {section: SectionName},
	Recolored: {},
	Resized: {viewport: Viewport},
	SceneChanged: {scene: SceneRead},
	ShortcutsClosed: {},
	ShortcutsToggled: {}
})

type H = Html.H<typeof Message.Type>

class Recolor extends Command.Service<Recolor>()('Portfolio/Recolor', {args: {}, success: Schema.Void}) {
	static readonly layer = this.toLayer(
		Effect.map(AtomRegistry.AtomRegistry, registry => () => Effect.sync(() => registry.set(recolorAtom, undefined)))
	)
}

function readViewport() {
	return {height: innerHeight, width: innerWidth}
}

// The host has no pointermove event. Keep the cursor on the pointer immediately, then let the presence atom send the normalized position.
const PointerMoves = Stream.unwrap(
	Effect.map(AtomRegistry.AtomRegistry, registry =>
		pipe(
			Stream.fromEventListener<PointerEvent>(document, 'pointermove', {passive: true}),
			Stream.tap(event =>
				Effect.sync(() => {
					// A swipe scrolls the page; only a hovering pointer paints a trail.
					if (event.pointerType === 'touch' || !(event.target instanceof Element)) return
					const page = event.target.closest<HTMLElement>('#portfolio-page')
					if (Predicate.isNull(page)) return
					page.style.setProperty('--pointer-x', `${event.clientX}px`)
					page.style.setProperty('--pointer-y', `${event.clientY}px`)
					const size = readViewport()
					if (size.width === 0 || size.height === 0) return
					registry.set(ownCursorAtom, {
						x: Number.clamp(event.clientX / size.width, {maximum: 0.999999, minimum: 0}),
						y: Number.clamp(event.clientY / size.height, {maximum: 0.999999, minimum: 0})
					})
				})
			),
			Stream.drain
		)
	)
)

function TrailGrid(h: H, trails: Visitors, size: Viewport) {
	return h
		.el('svg')
		.attrs({
			'aria-hidden': 'true',
			class: 'pointer-events-none fixed inset-0 z-1 size-full print:hidden',
			'shape-rendering': 'crispEdges'
		})
		.children(
			Array.map(trailCells(trails, size), cell =>
				h
					.el('rect')
					.key(cell.key)
					.attrs({
						fill: cell.fill,
						'fill-opacity': `${cell.opacity}`,
						height: '24',
						width: '24',
						x: `${cell.x}`,
						y: `${cell.y}`
					})
			)
		)
}

function labelOverReadingColumn(at: number, size: Viewport, width: number) {
	const left = (size.width - 768) / 2
	const right = (size.width + 768) / 2
	if (at < left) return at + width > left
	return at <= right || at - width < right
}

// Visitors use server positions; the hidden system pointer's replacement follows local CSS variables above them.
function Cursor(h: H, cursor: Visitor, own: boolean, size: Viewport) {
	const label = Boolean.match(own, {onFalse: () => cursor.name, onTrue: Function.constant('You')})
	const at = cursor.x * size.width
	// An 8px glyph plus 28px for the icon and padding.
	const width = label.length * 8 + 28
	const x = `${at}px`
	const y = `${cursor.y * size.height}px`
	const position = Boolean.match(own, {
		onFalse: () => ({className: 'z-5', transform: `translate3d(${x}, ${y}, 0)`}),
		onTrue: () => ({className: 'z-20', transform: `translate3d(var(--pointer-x, ${x}), var(--pointer-y, ${y}), 0)`})
	})
	return h.div
		.key(cursor.id)
		.attr('aria-hidden', 'true')
		.class('pointer-events-none fixed top-0 left-0 transform-(--cursor-transform)', position.className)
		.style({'--cursor-color': cursor.color, '--cursor-transform': position.transform})
		.children(
			h.div
				.class('flex items-center gap-1', at + width > size.width - 8 && '-translate-x-full flex-row-reverse')
				.children(
					Icon(h, 'cursor', 'size-4 text-(--cursor-color)'),
					!labelOverReadingColumn(at, size, width) &&
						h.span
							.class(
								'bg-background text-foreground rounded-none border border-(--cursor-color) px-1.5 py-0.5 font-mono text-xs leading-none whitespace-nowrap'
							)
							.children(label)
				)
		)
}

function ShortcutRow(h: H, label: string, keys: View.Input<typeof Message.Type>, title?: string) {
	return h.div
		.class('flex min-h-9 items-center justify-between gap-6 py-2')
		.children(h.span.class('text-sm').attr('title', title).children(label), keys)
}

function ShortcutsOverlay(h: H) {
	const key = h.kbd.class(
		'pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none'
	)
	return h.dialog
		.class('portfolio-shortcuts')
		.attrs({'aria-labelledby': 'shortcuts-title', closedby: 'any'})
		.modal(true)
		.on('cancel', Message.ShortcutsClosed(), {preventDefault: true})
		.on('close', Message.ShortcutsClosed())
		.children(
			h.h2.id('shortcuts-title').class('text-sm font-medium').children('Shortcuts'),
			h.div.class('flex flex-col').children(
				ShortcutRow(
					h,
					'Jump to a section',
					h.span.class('inline-flex items-center gap-1').children(key.children('1'), '–', key.children('6')),
					pipe(
						SectionName.literals,
						Array.map((name, index) => `${index + 1} ${name}`),
						Array.join(' · ')
					)
				),
				ShortcutRow(h, 'Change cursor color', key.children('r')),
				ShortcutRow(h, 'Toggle this panel', key.children('?')),
				ShortcutRow(h, 'Close this panel', key.children('Esc'))
			),
			h.button
				.class('portfolio-button portfolio-ghost absolute top-2 right-2 size-7')
				.attrs({'aria-label': 'Close', autofocus: '', type: 'button'})
				.on('click', Message.ShortcutsClosed())
				.children(Icon(h, 'close', 'size-4'))
		)
}

// Italian law asks a VAT holder's website to show the number on its home page.
const LEGAL_LINE = `© 2026 ${profile.firstName} ${profile.lastName} · VAT ${profile.vat}`
const LEGAL_LINE_NARROW = `© 2026 · VAT ${profile.vat}`

function PresenceText(h: H, model: Model) {
	if (!AsyncResult.isSuccess(model.scene)) {
		return [
			h.span.class('bg-muted-foreground/50 size-1.5 rounded-full'),
			h.span
				.class('text-muted-foreground truncate')
				.children(
					Boolean.match(AsyncResult.isFailure(model.scene), {
						onFalse: Function.constant('presence connecting'),
						onTrue: Function.constant('presence unavailable')
					})
				)
		]
	}
	const visitors = Array.length(model.scene.value.visitors)
	return [
		h.span.class('size-1.5 rounded-full bg-(--identity-color)').style({'--identity-color': model.color}),
		h.span.class('text-foreground tabular-nums').children(`${visitors}`),
		h.span
			.class('text-muted-foreground')
			.children(
				Boolean.match(visitors === 1, {onFalse: Function.constant('visitors'), onTrue: Function.constant('visitor')})
			)
	]
}

function PresenceHud(h: H, model: Model) {
	return h.div
		.class(
			'border-border bg-background/95 pr-safe-right pb-safe-bottom pl-safe-left pointer-events-none fixed inset-x-0 bottom-0 z-50 border-t font-mono text-xs backdrop-blur print:hidden'
		)
		.children(
			h.div.class('relative flex min-h-10 items-center justify-between px-3 sm:px-4').children(
				h.span.class('flex min-w-0 items-center gap-2').children(PresenceText(h, model)),
				h.span
					.class(
						'text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap max-sm:static max-sm:translate-x-0 max-sm:translate-y-0 pointer-coarse:static pointer-coarse:translate-x-0 pointer-coarse:translate-y-0'
					)
					.children(
						h.span.class('hidden sm:inline').children(LEGAL_LINE),
						h.span.class('sm:hidden').children(LEGAL_LINE_NARROW)
					),
				h.span.class('pointer-events-auto flex pointer-coarse:hidden').children(
					h.button
						.class('portfolio-button portfolio-ghost h-6 px-2')
						.attrs({
							'aria-expanded': `${model.shortcutsOpen}`,
							'aria-haspopup': 'dialog',
							'aria-label': 'Toggle keyboard shortcuts',
							type: 'button'
						})
						.on('click', Message.ShortcutsToggled())
						.children('?')
				)
			)
		)
}

// Before the first scene and through an outage, show the HUD, never a stale room.
function PresenceLayer(h: H, read: Model['scene'], viewport: Viewport) {
	if (!AsyncResult.isSuccess(read)) return h.div.class('contents')
	const scene = read.value
	return h.div.class('contents').children(
		h.div.class('trail-grid pointer-events-none fixed inset-0 z-1 print:hidden'),
		TrailGrid(h, scene.trails, viewport),
		h.div.class('max-sm:hidden print:hidden').children(
			h.div.class('mouse:contents hidden').children(
				pipe(
					scene.visitors,
					Array.appendAll(scene.bots),
					Array.filter(cursor => cursor.id !== scene.own),
					Array.map(cursor => Cursor(h, cursor, false, viewport))
				)
			)
		)
	)
}

export const Portfolio = pipe(
	Html.component({message: Message, model: Model, name: 'Portfolio'}).make({
		init: () => ({
			color: Color.literals[0],
			cursor: {x: 0.5, y: 0.5},
			scene: AsyncResult.initial(),
			shortcutsOpen: false,
			viewport: readViewport()
		}),
		subscriptions: () => [
			Subscription.make(
				'presence',
				Stream.unwrap(
					Effect.map(AtomRegistry.AtomRegistry, registry =>
						Stream.mergeAll<typeof Message.Type, never, never>(
							[
								pipe(
									registry,
									AtomRegistry.toStream(sceneAtom),
									Stream.map(scene => Message.SceneChanged({scene}))
								),
								pipe(
									registry,
									AtomRegistry.toStream(ownColorAtom),
									Stream.map(color => Message.ColorChanged({color}))
								),
								pipe(
									registry,
									AtomRegistry.toStream(ownCursorAtom),
									Stream.map(cursor => Message.CursorMoved({cursor}))
								),
								Stream.drain(AtomRegistry.toStream(registry, sendCursorAtom))
							],
							{concurrency: 'unbounded'}
						)
					)
				)
			),
			Subscription.make('pointer', PointerMoves),
			Subscription.make(
				'resize',
				Stream.map(Stream.fromEventListener(window, 'resize'), () => Message.Resized({viewport: readViewport()}))
			),
			HtmlSubscription.shortcuts([
				...Array.map(SectionName.literals, (section, index) => ({
					key: `${index + 1}`,
					message: Message.JumpedToSection({section})
				})),
				{key: 'r', message: Message.Recolored()},
				{key: '?', message: Message.ShortcutsToggled(), shift: true}
			])
		],
		update: {
			ColorChanged: ($, message) => $.evolve({color: message.color}),
			CursorMoved: ($, message) => $.evolve({cursor: message.cursor}),
			JumpedToSection: ($, message) =>
				$.run(
					Command.asNoop(
						HtmlCommand.ScrollIntoView.make({
							options: {behavior: 'auto', block: 'start'},
							ref: sectionTargets[message.section]
						})
					)
				),
			Recolored: $ => $.run(Command.asNoop(Recolor.make({}))),
			Resized: ($, message) => $.evolve({viewport: message.viewport}),
			SceneChanged: ($, message) => $.evolve({scene: message.scene}),
			ShortcutsClosed: $ => $.evolve({shortcutsOpen: false}),
			ShortcutsToggled: $ => $.evolve({shortcutsOpen: !$.model.shortcutsOpen})
		},
		view: (h, model) =>
			h.main
				.id('portfolio-page')
				.attrs({'aria-label': 'Portfolio', tabindex: '0'})
				.class(
					'portfolio-page focus-visible:ring-border mouse:cursor-none relative min-h-0 flex-1 overflow-x-hidden overflow-y-scroll overscroll-contain focus-visible:ring-1 focus-visible:ring-inset print:h-auto print:overflow-visible'
				)
				.children(
					h.lazy(ReadingSections),
					h.div
						.class('mouse:contents hidden print:hidden')
						.children(
							Cursor(
								h,
								{...model.cursor, color: model.color, id: VisitorId.make('own'), name: 'You'},
								true,
								model.viewport
							)
						),
					h.lazy(PresenceLayer, model.scene, model.viewport),
					PresenceHud(h, model),
					model.shortcutsOpen && ShortcutsOverlay(h)
				)
	}),
	Component.provide(Layer.provideMerge(Recolor.layer, AtomRegistry.layer))
)
