import {assert, it} from '@effect/vitest'

import {DateTime, Option} from 'effect'

import {UserId} from '@deslop/runtime/shared/auth'

import {changeNote, newNote} from './changes.ts'

import {Note, NoteId} from '#services/notes/schema.ts'

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
	const shared = changeNote(NOTE, {
		_tag: 'share',
		capture: {id: NoteId.make('6f1c9a52-8d0e-4c3b-9a51-2f6d7e8b9c02'), text: 'CUMIN soup'}
	})
	if (shared._tag !== 'Changed') return assert.fail('Expected a changed note')
	assert.strictEqual(shared.note.text, 'lentils cumin\nsoup')
	assert.strictEqual(changeNote(NOTE, {_tag: 'share', capture: CAPTURE})._tag, 'Unchanged')
})

it('starts a failed note over and publishes the completed organization', () => {
	const failed = changeNote(NOTE, {_tag: 'fail', message: 'Offline'})
	if (failed._tag !== 'Changed') return assert.fail('Expected a failed note')
	const retried = changeNote(Note.make(failed.note), {_tag: 'retry'})
	if (retried._tag !== 'Changed') return assert.fail('Expected a retry')
	assert.deepStrictEqual([retried.note.status, retried.note.issue], ['organizing', Option.none()])
	const ready = changeNote(Note.make(retried.note), {
		_tag: 'organize',
		organization: {body: 'Recipe', screenText: '', summary: 'Lentil soup', title: 'Soup', topics: 'cooking'}
	})
	if (ready._tag !== 'Changed') return assert.fail('Expected an organized note')
	assert.deepStrictEqual([ready.note.status, ready.note.title, ready.note.summary], ['ready', 'Soup', 'Lentil soup'])
})
