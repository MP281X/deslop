import type {RowData} from '#src/shared/model.ts'

export const rows: readonly RowData[] = [
	{
		id: 'duo-preview',
		line: 'worker · 23446',
		problem: {reason: 'Exited with code 3 · just now', status: 'error'},
		title: 'Duo preview',
		trailing: '14:42'
	},
	{id: 'minecraft', line: 'worker · 25565', title: 'Minecraft', trailing: '14:38'},
	{id: 't3', line: 'worker · 3773', title: 'T3 Code', trailing: '14:34'},
	{id: 'stash', line: 'worker · 5104', title: 'Stash', trailing: '14:29'},
	{id: 'scope', line: 'worker · 5101', title: 'Scope', trailing: '14:23'},
	{id: 'deploy', line: 'worker · 5103', title: 'Deploy', trailing: '14:12'},
	{id: 'auth', line: 'worker · 5102', title: 'Auth', trailing: '13:56'},
	{id: 'trips', line: 'worker · 5105', title: 'Trips', trailing: '13:45'},
	{id: 'portfolio', line: 'worker · 5109', title: 'Portfolio', trailing: '13:38'},
	{id: 'opm', line: 'worker · 5106', title: 'OPM', trailing: '13:29'},
	{id: 'queue', line: 'worker · 23447', title: 'Preview queue', trailing: '13:18'},
	{id: 'registry', line: 'worker · 23448', title: 'Registry', trailing: '13:09'},
	{id: 'notes', line: 'worker · 23449', title: 'Notes', trailing: '12:54'}
]

export const sheet = {
	action: 'Done',
	body: 'Run this in the service’s working directory to restart the process.',
	title: 'Restart command'
}

export function detailBody(row: RowData) {
	return row.problem?.reason ?? row.line
}

export function detailFigure(row: RowData) {
	return `Last update   ${row.trailing ?? '—'}`
}
