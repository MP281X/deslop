import {assert, it} from '@effect/vitest'

import {DateTime, Option} from 'effect'

import {UserId} from '@deslop/runtime/shared/auth'

import {changeNote, newNote} from './changes.ts'

import {Note, NoteChange, NoteChangeResult, NoteId} from '#services/notes/schema.ts'

const USER = UserId.make('github:1')
const CAPTURE = {id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c01'), text: 'lentils cumin'}
const NOTE = Note.make({...newNote(USER, CAPTURE, Option.none(), Option.none()), createdAt: DateTime.makeUnsafe(0)})

it('uses a shared comment as the title and an uploaded photo as its preview', () => {
	const link = newNote(
		USER,
		{...CAPTURE, text: '  Read this https://example.com/article  '},
		Option.some('https://example.com/article'),
		Option.none()
	)
	assert.deepStrictEqual([link.title, link.text], ['Read this', 'Read this https://example.com/article'])
	assert.deepStrictEqual(
		newNote(USER, CAPTURE, Option.none(), Option.some('image/jpeg')).image,
		Option.some('image/jpeg')
	)
})

it('merges new words from another share while a retried capture stays unchanged', () => {
	const shared = changeNote(
		NOTE,
		NoteChange.cases.share.make({
			capture: {id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02'), text: 'CUMIN soup'}
		})
	)
	if (!NoteChangeResult.isAnyOf(['Changed'])(shared)) return assert.fail('Expected a changed note')
	assert.strictEqual(shared.note.text, 'lentils cumin\nsoup')
	assert.strictEqual(changeNote(NOTE, NoteChange.cases.share.make({capture: CAPTURE}))._tag, 'Unchanged')
})

it('starts a failed note over for whoever asked and publishes the completed organization', () => {
	const failed = changeNote(NOTE, NoteChange.cases.fail.make({issue: 'Offline'}))
	if (!NoteChangeResult.isAnyOf(['Changed'])(failed)) return assert.fail('Expected a failed note')
	const other = UserId.make('github:2')
	const retried = changeNote(Note.make(failed.note), NoteChange.cases.retry.make({requester: other}))
	if (!NoteChangeResult.isAnyOf(['Changed'])(retried)) return assert.fail('Expected a retry')
	assert.deepStrictEqual(
		[retried.note.status, retried.note.issue, retried.note.requester],
		['organizing', Option.none(), other]
	)
	const ready = changeNote(
		Note.make(retried.note),
		NoteChange.cases.organize.make({
			organization: {body: 'Recipe', screenText: '', summary: 'Lentil soup', title: 'Soup', topics: 'cooking'},
			read: 'lentils cumin'
		})
	)
	if (!NoteChangeResult.isAnyOf(['Changed'])(ready)) return assert.fail('Expected an organized note')
	assert.deepStrictEqual(
		[ready.note.status, ready.note.title, ready.note.summary, ready.note.body],
		['ready', 'Soup', 'Lentil soup', Option.some('Recipe')]
	)
})

it('keeps words shared after the organization read the note under its body', () => {
	const shared = changeNote(
		NOTE,
		NoteChange.cases.share.make({
			capture: {id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02'), text: 'add the appendix'}
		})
	)
	if (!NoteChangeResult.isAnyOf(['Changed'])(shared)) return assert.fail('Expected a shared note')
	const ready = changeNote(
		Note.make(shared.note),
		NoteChange.cases.organize.make({
			organization: {body: 'Recipe', screenText: '', summary: 'Lentil soup', title: 'Soup', topics: 'cooking'},
			read: NOTE.text
		})
	)
	if (!NoteChangeResult.isAnyOf(['Changed'])(ready)) return assert.fail('Expected an organized note')
	assert.deepStrictEqual(ready.note.body, Option.some('Recipe\n> add the appendix'))
	const later = changeNote(
		Note.make(ready.note),
		NoteChange.cases.share.make({
			capture: {id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c03'), text: 'served cold'}
		})
	)
	if (!NoteChangeResult.isAnyOf(['Changed'])(later)) return assert.fail('Expected a shared note')
	assert.deepStrictEqual(later.note.body, Option.some('Recipe\n> add the appendix\n> served cold'))
})

function emptied(note: Note) {
	const result = changeNote(note, NoteChange.cases.empty.make({}))
	if (!NoteChangeResult.isAnyOf(['Changed'])(result)) return assert.fail('Expected a failed note')
	return result.note
}

it('says a note with a file has nothing to read in the file, a link nothing at the link, and keeps a cause already found', () => {
	const created = {createdAt: DateTime.makeUnsafe(0)}
	const file = Note.make({...newNote(USER, CAPTURE, Option.none(), Option.some('video/mp4')), ...created})
	const link = Note.make({
		...newNote(USER, CAPTURE, Option.some('https://example.com/article'), Option.none()),
		...created
	})
	const explained = changeNote(file, NoteChange.cases.issue.make({issue: 'ffprobe exceeded its time limit'}))
	if (!NoteChangeResult.isAnyOf(['Changed'])(explained)) return assert.fail('Expected an explained note')
	assert.deepStrictEqual(
		[emptied(file).issue, emptied(link).issue, emptied(Note.make(explained.note)).issue],
		[
			Option.some('Nothing to read in this file.'),
			Option.some('Nothing to read at this link.'),
			Option.some('ffprobe exceeded its time limit')
		]
	)
})
