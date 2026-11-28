import {Array, Boolean, Function} from 'effect'

import {detailBody, detailFigure} from '#gallery/data.ts'
import {closeReader, dismissSheet, togglePending} from '#gallery/selection.ts'
import type {GalleryView} from '#gallery/selection.ts'
import type {RowOptions, Selection} from '#src/shared/model.ts'

export type GalleryDraw<Content> = {
	action: (label: string, message: typeof closeReader | typeof dismissSheet | typeof togglePending) => Content
	cover: () => Content
	label: (text: string) => Content
	reader: (detail: readonly Content[], closer: Content) => Content
	sheetBody: () => Content
	trend: () => Content
}

export type GalleryRows<H, Content> = {
	DetailText: (h: H, title: string, body: string, figure: string) => readonly Content[]
	Row: (h: H, options: RowOptions<Content>) => Content
}

function galleryList<H, Content>(
	h: H,
	options: GalleryView,
	design: GalleryRows<H, Content>,
	render: GalleryDraw<Content>
) {
	function detail() {
		if (options.loading || options.listOnly) return undefined
		if (options.selected === undefined) {
			return design.DetailText(h, 'Worker', 'Machine overview stays beside the list.', '13 services')
		}
		return [design.DetailText(h, options.selected.title, detailBody(options.selected), detailFigure(options.selected))]
	}

	return {
		defaultId: options.defaultId,
		detail: detail(),
		detailToolbar: options.detailToolbar,
		empty: render.label('No matching services'),
		header: render.label('On this worker'),
		list: Boolean.match(Array.isReadonlyArrayEmpty(options.rows), {
			onFalse: () => (activeId: Selection['id'], wide: boolean) => [
				render.label('Today'),
				Array.map(options.rows, item =>
					design.Row(h, {
						active: activeId === item.id,
						cover: render.cover(),
						item,
						muted: item.id === 't3',
						select: options.selection.select,
						trailing: Boolean.match(wide && item.id === 'duo-preview', {
							onFalse: Function.constUndefined,
							onTrue: render.trend
						})
					})
				)
			],
			onTrue: Function.constUndefined
		}),
		loading: options.loading,
		selection: options.selection,
		sheet: {
			actions: Boolean.match(options.pending, {
				onFalse: () => [render.action('Hold open', togglePending), render.action('Done', dismissSheet)],
				onTrue: () => render.action('Allow dismissal', togglePending)
			}),
			body: render.sheetBody(),
			dismiss: options.dismiss,
			height: 0.42,
			label: 'Paste a link',
			open: options.sheetOpen,
			pending: options.pending,
			toolbar: options.sheetToolbar
		},
		toolbar: options.toolbar
	}
}

export function renderGallery<H, Content, Screen>(
	h: H,
	options: GalleryView,
	design: GalleryRows<H, Content> & {
		Layout: (h: H, options: {content: Content}) => Screen
		ListDetail: (h: H, options: ReturnType<typeof galleryList<H, Content>>) => Screen
	},
	render: GalleryDraw<Content>
) {
	if (options.reader) {
		return design.Layout(h, {
			content: render.reader(
				design.DetailText(h, 'Reader', 'The app draws this edge-to-edge screen.', '1 / 1'),
				render.action('Close reader', closeReader)
			)
		})
	}
	return design.ListDetail(h, galleryList(h, options, design, render))
}
