import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {notes} from './notes.ts'

export function exportNotes(folder: string) {
	mkdirSync(folder, {recursive: true})
	for (const note of notes) writeFileSync(join(folder, `${note.id}.md`), `# ${note.title}\n\n${note.body}\n`)
	return notes.length
}
