import type {RowData} from '../src/shared/model.ts'

export const rows: readonly RowData[] = [
	{
		id: 'duo-preview',
		title: 'Duo preview',
		line: 'worker · 23446',
		trailing: '14:42',
		problem: {status: 'error', reason: 'Exited with code 3 · just now'}
	},
	{id: 'minecraft', title: 'Minecraft', line: 'worker · 25565', trailing: '14:38'},
	{id: 't3', title: 'T3 Code', line: 'worker · 3773', trailing: '14:34'},
	{id: 'stash', title: 'Stash', line: 'worker · 5104', trailing: '14:29'},
	{id: 'scope', title: 'Scope', line: 'worker · 5101', trailing: '14:23'},
	{id: 'deploy', title: 'Deploy', line: 'worker · 5103', trailing: '14:12'},
	{id: 'auth', title: 'Auth', line: 'worker · 5102', trailing: '13:56'},
	{id: 'trips', title: 'Trips', line: 'worker · 5105', trailing: '13:45'},
	{id: 'portfolio', title: 'Portfolio', line: 'worker · 5109', trailing: '13:38'},
	{id: 'opm', title: 'OPM', line: 'worker · 5106', trailing: '13:29'},
	{id: 'queue', title: 'Preview queue', line: 'worker · 23447', trailing: '13:18'},
	{id: 'registry', title: 'Registry', line: 'worker · 23448', trailing: '13:09'},
	{id: 'notes', title: 'Notes', line: 'worker · 23449', trailing: '12:54'}
]

export const sheet = {
	title: 'Restart command',
	body: 'Run this in the service’s working directory to restart the process.',
	action: 'Done'
}

export const detailBody = (row: RowData) => row.problem?.reason ?? row.line
export const detailFigure = (row: RowData) => `Last update   ${row.trailing ?? '—'}`
