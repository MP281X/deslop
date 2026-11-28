import type {Native} from '@effect/ui-native'

export const black = '#000'
export const ink = '#f4f4f4'
export const selected = '#222'
export const fold = '#292929'
export const status = {error: '#ff453a', warning: '#ffd60a'}

export const styles = {
	body: {color: ink, fontSize: 15, lineHeight: 22},
	control: {
		alignItems: 'center',
		backgroundColor: '#202020',
		borderRadius: 8,
		display: 'flex',
		justifyContent: 'center',
		minHeight: 40,
		minWidth: 40,
		paddingInline: 10
	},
	detail: {display: 'flex', flexDirection: 'column', gap: 8, padding: 20},
	dot: {borderRadius: 3, flexShrink: 0, height: 6, width: 6},
	frame: {backgroundColor: black, display: 'flex', flex: 1, minHeight: 0},
	heading: {color: ink, fontSize: 20, fontWeight: '600', lineHeight: 26},
	lead: {display: 'flex', flex: 1, flexDirection: 'column', minWidth: 0},
	line: {color: '#a1a1a1', fontSize: 13, lineHeight: 18},
	pane: {flex: 1, minHeight: 0, minWidth: 0},
	panes: {display: 'flex', flex: 1, flexDirection: 'row', minHeight: 0},
	row: {
		alignItems: 'center',
		borderRadius: 8,
		display: 'flex',
		flexDirection: 'row',
		gap: 12,
		minHeight: 54,
		paddingBlock: 7,
		paddingInline: 12
	},
	rows: {padding: 8},
	sheet: {backgroundColor: '#151515', display: 'flex', flexDirection: 'column', gap: 16, padding: 20},
	sheetActions: {display: 'flex', flexDirection: 'row', gap: 8, justifyContent: 'flex-end'},
	title: {color: ink, flexShrink: 1, fontSize: 15, fontWeight: '600', lineHeight: 20},
	titleLine: {alignItems: 'center', display: 'flex', flexDirection: 'row', gap: 6, minWidth: 0}
} as const satisfies Readonly<Record<string, Native.TextStyle>>
