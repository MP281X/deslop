import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Effect, Layer, Option, Order, Predicate, Record, Schema, SchemaAST, String, pipe} from 'effect'

import type {Migrator, SqlError} from 'effect/sql'
import {SqlClient} from 'effect/sql'

import {Sessions} from '#server/sessions.ts'

type Model = Schema.Top & {readonly table: string}

// A service's migrations need only the app's SqlClient.
type Migrations = Layer.Layer<never, Migrator.MigrationError | SqlError.SqlError, SqlClient.SqlClient>

type ColumnInfo = typeof ColumnInfo.Type
const ColumnInfo = Schema.Struct({name: Schema.String, notnull: Schema.BooleanFromBit, type: Schema.String})

// Every app runs on the runtime, whose sessions table sits beside the app's own; then every service whose class carries its `migrations`, and every model that names its `table`, by app: one app is one database.
const servers = import.meta.glob('../../../../apps/*/src/main.server.ts')
const services = import.meta.glob<Record<string, unknown>>('../../../../apps/*/src/services/*/service.ts', {
	eager: true
})
const schemas = import.meta.glob<Record<string, unknown>>('../../../../apps/*/src/services/*/schema.ts', {eager: true})

function appOf(file: string) {
	return Option.getOrThrow(Array.get(String.split(file, '/'), 5))
}

function exportsOf(modules: Record<string, Record<string, unknown>>, app: string) {
	return pipe(
		Record.toEntries(modules),
		Array.filter(entry => appOf(entry[0]) === app),
		Array.flatMap(entry => Record.values(entry[1]))
	)
}

const apps = Array.map(Record.keys(servers), file => {
	const app = appOf(file)
	return {
		app,
		migrations: pipe(
			exportsOf(services, app),
			Array.filter(value => Predicate.hasProperty(value, 'migrations')),
			Array.map(service => service.migrations),
			Array.filter((value): value is Migrations => Layer.isLayer(value)),
			Array.prepend(Sessions.migrations)
		),
		models: pipe(
			exportsOf(schemas, app),
			Array.filter(
				(value): value is Model =>
					Schema.isSchema(value) && Predicate.hasProperty(value, 'table') && Predicate.isString(value.table)
			),
			Array.prepend<Model>(Sessions.model)
		)
	}
})

// The type and nullability a field's encoded side needs in a STRICT table; only a field that encodes to null is nullable.
function columnOf(ast: SchemaAST.AST): {readonly nullable: boolean; readonly types: readonly string[]} {
	if (SchemaAST.isUnion(ast)) {
		const members = Array.map(ast.types, columnOf)
		return {
			nullable: Array.some(members, member => member.nullable),
			types: Array.dedupe(Array.flatMap(members, member => member.types))
		}
	}
	if (SchemaAST.isNull(ast)) return {nullable: true, types: []}
	if (SchemaAST.isString(ast) || SchemaAST.isTemplateLiteral(ast)) return {nullable: false, types: ['TEXT']}
	if (SchemaAST.isLiteral(ast)) {
		return {
			nullable: false,
			types: [Boolean.match(Predicate.isString(ast.literal), {onFalse: () => 'INTEGER', onTrue: () => 'TEXT'})]
		}
	}
	if (SchemaAST.isNumber(ast)) {
		const integer = Array.some(
			ast.checks ?? [],
			check => check.annotations?.representation?.id === 'effect/schema/isInt'
		)
		return {nullable: false, types: [Boolean.match(integer, {onFalse: () => 'REAL', onTrue: () => 'INTEGER'})]}
	}
	return {nullable: false, types: [`unknown ${ast._tag}`]}
}

function expectedColumns(model: Model) {
	const encoded = SchemaAST.toEncoded(model.ast)
	if (!SchemaAST.isObjects(encoded)) return assert.fail(`${model.table} encodes to an object`)
	return pipe(
		encoded.propertySignatures,
		// A key the row may leave out, such as a kind's tag that decoding fills in, is no column.
		Array.filter(property => !SchemaAST.isOptional(property.type)),
		Array.map(property => {
			const column = columnOf(property.type)
			return {name: property.name.toString(), notnull: !column.nullable, type: Array.join(column.types, '|')}
		}),
		Array.sort(Order.mapInput(Order.String, (column: ColumnInfo) => column.name))
	)
}

// Every service of the app migrates one database; then each table is compared with its model through SQLite's own description.
const checked = Effect.fnUntraced(function* (migrations: readonly Migrations[], models: readonly Model[]) {
	const sql = yield* SqlClient.SqlClient
	yield* Effect.forEach(migrations, Layer.build, {concurrency: 1, discard: true})
	const tables = yield* sql<{name: string}>`
		SELECT name FROM sqlite_schema
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_migrations'
		ORDER BY name
	`
	assert.deepStrictEqual(
		Array.map(tables, table => table.name),
		Array.sort(
			Array.map(models, model => model.table),
			Order.String
		),
		'one model per table'
	)
	yield* Effect.forEach(
		models,
		Effect.fnUntraced(function* (model) {
			const columns = yield* Effect.flatMap(
				sql`SELECT name, type, "notnull" FROM pragma_table_xinfo(${model.table}) ORDER BY name`,
				Schema.decodeUnknownEffect(Schema.Array(ColumnInfo))
			)
			assert.deepStrictEqual(columns, expectedColumns(model), model.table)
		}),
		{concurrency: 1, discard: true}
	)
})

it.effect.each(apps)('$app: every table has one model, and every model matches its table', app =>
	Effect.scoped(
		Effect.gen(function* () {
			yield* Effect.provideContext(
				checked(app.migrations, app.models),
				yield* Layer.build(SqliteClient.layer({filename: ':memory:'}))
			)
		})
	)
)
