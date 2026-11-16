import assert from 'node:assert/strict'
import {deflateRawSync} from 'node:zlib'

import {it} from '@effect/vitest'

import {passText} from './utils.ts'

function archive(text: string, method: number, name = 'pass.json') {
	const body = Buffer.from(text)
	const data = method === 8 ? deflateRawSync(body) : body
	const filename = Buffer.from(name)
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50)
	local.writeUInt16LE(8, 6) // Sizes are in the directory, as with a streaming ZIP writer.
	local.writeUInt16LE(method, 8)
	local.writeUInt16LE(filename.length, 26)
	const directory = Buffer.alloc(46)
	directory.writeUInt32LE(0x02014b50)
	directory.writeUInt16LE(8, 8)
	directory.writeUInt16LE(method, 10)
	directory.writeUInt32LE(data.length, 20)
	directory.writeUInt32LE(body.length, 24)
	directory.writeUInt16LE(filename.length, 28)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50)
	end.writeUInt16LE(1, 8)
	end.writeUInt16LE(1, 10)
	end.writeUInt32LE(directory.length + filename.length, 12)
	end.writeUInt32LE(local.length + filename.length + data.length, 16)
	return Buffer.concat([local, filename, data, directory, filename, end])
}

it('reads the Wallet pass JSON from stored and deflated archives and refuses invalid passes', async () => {
	const text = '{"description":"Trainline ticket","boardingPass":{"primaryFields":[{"value":"Milano → Roma"}]}}'
	assert.strictEqual(await passText(archive(text, 0)), text)
	assert.strictEqual(await passText(archive(text, 8)), text)
	await assert.rejects(passText(archive(text, 8, 'manifest.json')), /no pass.json/u)
	await assert.rejects(passText(archive('x'.repeat(240_001), 8)), /too large/u)
	await assert.rejects(passText(archive('not JSON', 8)))
	await assert.rejects(passText(Buffer.from('not a ZIP')), /not a ZIP/u)
	await assert.rejects(passText(archive(text, 8).subarray(0, 40)))
})
