import {Effect, Schema} from 'effect'

import {SqlSchema} from 'effect/sql'
import type {SqlClient, Statement} from 'effect/sql'

import {searchable} from './content.ts'

// The search row of each note the condition selects, from its texts and tags as `searchable` spells them, so the index and a query fold text alike.
export const indexNotes = Effect.fnUntraced(function* (sql: SqlClient.SqlClient, condition: Statement.Fragment) {
	const rows = yield* SqlSchema.findAll({
		Request: Schema.Void,
		Result: Schema.Struct({rowid: Schema.Int, tags: Schema.String, text: Schema.String}),
		execute: () => sql`
			SELECT rowid,
				concat_ws(' ', title, summary, author, text, content, topics, body, screenText, transcript, url) AS text,
				coalesce((SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = notes.id), '') AS tags
			FROM notes WHERE ${condition}
		`
	})()
	yield* Effect.forEach(
		rows,
		row =>
			Effect.andThen(
				sql`DELETE FROM note_search WHERE rowid = ${row.rowid}`,
				sql`INSERT INTO note_search(rowid, text, tags) VALUES (${row.rowid}, ${searchable(row.text)}, ${searchable(row.tags)})`
			),
		{concurrency: 1, discard: true}
	)
})
