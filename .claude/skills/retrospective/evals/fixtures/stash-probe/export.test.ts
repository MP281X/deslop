import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'

import {exportNotes} from './export.ts'

test('writes one markdown file per note', () => {
	const folder = mkdtempSync(join(tmpdir(), 'export-'))
	assert.equal(exportNotes(folder), 2)
	assert.match(readFileSync(join(folder, 'a1.md'), 'utf8'), /^# Effect atoms/)
})
