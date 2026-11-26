import {Effect, Layer} from 'effect'

import {Migrator, SqlClient} from 'effect/sql'

import {indexNotes} from './lib/search.ts'

// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
export const migrations = Layer.effectDiscard(
	Migrator.make({})({
		loader: Migrator.fromRecord({
			'0001_notes': Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`
					CREATE TABLE notes (
						id TEXT PRIMARY KEY,
						createdAt INTEGER NOT NULL,
						requester TEXT NOT NULL,
						source TEXT NOT NULL,
						status TEXT NOT NULL,
						title TEXT NOT NULL,
						summary TEXT NOT NULL,
						text TEXT NOT NULL,
						content TEXT NOT NULL,
						author TEXT,
						body TEXT,
						file TEXT,
						image TEXT,
						issue TEXT,
						screenText TEXT,
						topics TEXT,
						transcript TEXT,
						url TEXT
					) STRICT
				`
				yield* sql`CREATE INDEX notes_by_created ON notes (createdAt, id)`
				yield* sql`CREATE INDEX notes_by_url ON notes (url)`
				yield* sql`CREATE TABLE tags (name TEXT PRIMARY KEY, definition TEXT) STRICT`
				yield* sql`
					CREATE TABLE note_tags (
						noteId TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
						tag TEXT NOT NULL REFERENCES tags (name),
						position INTEGER NOT NULL,
						PRIMARY KEY (noteId, tag)
					) STRICT, WITHOUT ROWID
				`
				yield* sql`CREATE INDEX note_tags_by_tag ON note_tags (tag)`
			}),
			'0002_search_changes': Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`CREATE VIRTUAL TABLE note_search USING fts5(text, tags, tokenize = 'unicode61')`
				yield* sql`INSERT INTO note_search(rowid, text, tags)
					SELECT rowid, concat_ws(' ', title, summary, author, text, content, topics, body, screenText, transcript, url),
						(SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = notes.id) FROM notes`
				yield* sql`CREATE TABLE note_changes (id TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT`
				yield* sql`CREATE INDEX note_changes_by_version ON note_changes(version)`
				yield* sql`CREATE TRIGGER notes_insert AFTER INSERT ON notes BEGIN
					INSERT INTO note_search(rowid, text, tags) VALUES(new.rowid,
						concat_ws(' ', new.title, new.summary, new.author, new.text, new.content, new.topics, new.body, new.screenText, new.transcript, new.url), '');
					INSERT INTO note_changes(id, version) VALUES(new.id, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
						ON CONFLICT(id) DO UPDATE SET version = excluded.version;
				END`
				yield* sql`CREATE TRIGGER notes_update AFTER UPDATE ON notes BEGIN
					UPDATE note_search SET text = concat_ws(' ', new.title, new.summary, new.author, new.text, new.content, new.topics, new.body, new.screenText, new.transcript, new.url) WHERE rowid = new.rowid;
					INSERT INTO note_changes(id, version) VALUES(new.id, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
						ON CONFLICT(id) DO UPDATE SET version = excluded.version;
				END`
				yield* sql`CREATE TRIGGER notes_delete AFTER DELETE ON notes BEGIN
					DELETE FROM note_search WHERE rowid = old.rowid;
					INSERT INTO note_changes(id, version) VALUES(old.id, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
						ON CONFLICT(id) DO UPDATE SET version = excluded.version;
				END`
				yield* sql`CREATE TRIGGER note_tags_insert AFTER INSERT ON note_tags BEGIN
					UPDATE note_search SET tags = (SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = new.noteId)
						WHERE rowid = (SELECT rowid FROM notes WHERE id = new.noteId);
					INSERT INTO note_changes(id, version) VALUES(new.noteId, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
						ON CONFLICT(id) DO UPDATE SET version = excluded.version;
				END`
				yield* sql`CREATE TRIGGER note_tags_delete AFTER DELETE ON note_tags BEGIN
					UPDATE note_search SET tags = (SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = old.noteId)
						WHERE rowid = (SELECT rowid FROM notes WHERE id = old.noteId);
					INSERT INTO note_changes(id, version) VALUES(old.noteId, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
						ON CONFLICT(id) DO UPDATE SET version = excluded.version;
				END`
			}),
			'0003_retired_notes': Effect.flatMap(
				SqlClient.SqlClient,
				sql => sql`CREATE TABLE retired_notes (id TEXT PRIMARY KEY, mergedInto TEXT) STRICT`
			),
			// The service writes each search row from text `searchable` folds, so the triggers keep only the change versions.
			'0004_searchable_text': Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* Effect.forEach(
					[
						{event: 'INSERT', note: 'new.id', table: 'notes', trigger: 'notes_insert'},
						{event: 'UPDATE', note: 'new.id', table: 'notes', trigger: 'notes_update'},
						{event: 'INSERT', note: 'new.noteId', table: 'note_tags', trigger: 'note_tags_insert'},
						{event: 'DELETE', note: 'old.noteId', table: 'note_tags', trigger: 'note_tags_delete'}
					],
					change =>
						Effect.andThen(
							sql`DROP TRIGGER ${sql(change.trigger)}`,
							sql`CREATE TRIGGER ${sql(change.trigger)} AFTER ${sql.literal(change.event)} ON ${sql(change.table)} BEGIN
								INSERT INTO note_changes(id, version) VALUES(${sql.literal(change.note)}, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
									ON CONFLICT(id) DO UPDATE SET version = excluded.version;
							END`
						),
					{concurrency: 1, discard: true}
				)
				yield* sql`DELETE FROM note_search`
				yield* indexNotes(sql, sql`1 = 1`)
			})
		}),
		table: 'notes_migrations'
	})
)
