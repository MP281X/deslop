import type {Native} from '@effect/ui-native'

export const black = '#000'
export const ink = '#f4f4f4'
export const muted = '#a1a1a1'
export const selected = '#222'
export const fold = '#292929'
export const status = {error: '#ff453a', warning: '#ffd60a'}

export type SheetData = {title: string; body: string; action: string}

export const styles = {
	frame: {display: 'flex', flex: 1, minHeight: 0, backgroundColor: black},
	panes: {display: 'flex', flexDirection: 'row', flex: 1, minHeight: 0},
	pane: {flex: 1, minWidth: 0, minHeight: 0},
	rows: {padding: 8},
	row: {
		display: 'flex',
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		minHeight: 54,
		paddingInline: 12,
		paddingBlock: 7,
		borderRadius: 8
	},
	lead: {display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0},
	titleLine: {display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0},
	title: {color: ink, fontSize: 15, lineHeight: 20, fontWeight: '600', flexShrink: 1},
	line: {color: muted, fontSize: 13, lineHeight: 18},
	dot: {height: 6, width: 6, borderRadius: 3, flexShrink: 0},
	detail: {padding: 20, gap: 8, display: 'flex', flexDirection: 'column'},
	heading: {color: ink, fontSize: 20, lineHeight: 26, fontWeight: '600'},
	body: {color: ink, fontSize: 15, lineHeight: 22},
	sheet: {backgroundColor: '#151515', padding: 20, gap: 16, display: 'flex', flexDirection: 'column'},
	sheetActions: {display: 'flex', flexDirection: 'row', gap: 8, justifyContent: 'flex-end'},
	control: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		minHeight: 40,
		minWidth: 40,
		borderRadius: 8,
		paddingInline: 10,
		backgroundColor: '#202020'
	}
} as const satisfies Readonly<Record<string, Native.TextStyle>>
