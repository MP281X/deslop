import assert from 'node:assert/strict'
import {deflateRawSync} from 'node:zlib'

import {it} from '@effect/vitest'

import {Effect, Match, String, pipe} from 'effect'

import {passText} from './pkpass.ts'

function archive(text: string, method: number, name = 'pass.json') {
	const body = Buffer.from(text)
	const encoded = pipe(
		Match.value(method),
		Match.when(8, () => deflateRawSync(body)),
		Match.orElse(() => body)
	)
	const filename = Buffer.from(name)
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04_03_4b_50)
	// Sizes are in the directory, as with a streaming ZIP writer.
	local.writeUInt16LE(8, 6)
	local.writeUInt16LE(method, 8)
	local.writeUInt16LE(filename.length, 26)
	const directory = Buffer.alloc(46)
	directory.writeUInt32LE(0x02_01_4b_50)
	directory.writeUInt16LE(8, 8)
	directory.writeUInt16LE(method, 10)
	directory.writeUInt32LE(encoded.length, 20)
	directory.writeUInt32LE(body.length, 24)
	directory.writeUInt16LE(filename.length, 28)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06_05_4b_50)
	end.writeUInt16LE(1, 8)
	end.writeUInt16LE(1, 10)
	end.writeUInt32LE(directory.length + filename.length, 12)
	end.writeUInt32LE(local.length + filename.length + encoded.length, 16)
	return Buffer.concat([local, filename, encoded, directory, filename, end])
}

it.effect(
	'reads the Wallet pass JSON from stored and deflated archives and refuses invalid passes',
	Effect.fnUntraced(function* () {
		const text = '{"description":"Boarding pass","boardingPass":{"primaryFields":[{"value":"Milano → Roma"}]}}'
		assert.strictEqual(yield* passText(archive(text, 0)), text)
		assert.strictEqual(yield* passText(archive(text, 8)), text)
		assert.match((yield* Effect.flip(passText(archive(text, 8, 'manifest.json')))).message, /no pass.json/u)
		assert.match((yield* Effect.flip(passText(archive(String.repeat(240_001)('x'), 8)))).message, /too large/u)
		yield* Effect.flip(passText(archive('not JSON', 8)))
		assert.match((yield* Effect.flip(passText(Buffer.from('not a ZIP')))).message, /not a ZIP/u)
		yield* Effect.flip(passText(archive(text, 8).subarray(0, 40)))
	})
)
