import {promisify} from 'node:util'
import {inflateRaw} from 'node:zlib'

const inflate = promisify(inflateRaw)
const MAX_PASS_BYTES = 240_000

// Wallet archives use the central directory: local headers may leave sizes in a trailing data descriptor.
export async function passText(bytes: Uint8Array) {
	const zip = Buffer.from(bytes)
	let end = zip.length - 22
	while (end >= Math.max(0, zip.length - 65_557)) {
		if (zip.readUInt32LE(end) === 0x06054b50 && end + 22 + zip.readUInt16LE(end + 20) === zip.length) break
		end--
	}
	if (end < Math.max(0, zip.length - 65_557)) throw new Error('The Wallet pass is not a ZIP archive.')
	if (zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) {
		throw new Error('The Wallet pass spans multiple archives.')
	}
	const count = zip.readUInt16LE(end + 10)
	let offset = zip.readUInt32LE(end + 16)
	const directoryEnd = offset + zip.readUInt32LE(end + 12)
	if (directoryEnd > end) throw new Error('The Wallet pass directory is invalid.')
	for (let index = 0; index < count; index++) {
		if (offset + 46 > directoryEnd || zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error('The Wallet pass directory is invalid.')
		}
		const nameLength = zip.readUInt16LE(offset + 28)
		const next = offset + 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
		if (next > directoryEnd) throw new Error('The Wallet pass directory is invalid.')
		if (zip.toString('utf8', offset + 46, offset + 46 + nameLength) === 'pass.json') {
			const method = zip.readUInt16LE(offset + 10)
			const compressed = zip.readUInt32LE(offset + 20)
			const size = zip.readUInt32LE(offset + 24)
			const local = zip.readUInt32LE(offset + 42)
			if ((zip.readUInt16LE(offset + 8) & 1) !== 0 || size > MAX_PASS_BYTES) {
				throw new Error('The Wallet pass is encrypted or too large.')
			}
			if (local + 30 > offset || zip.readUInt32LE(local) !== 0x04034b50) {
				throw new Error('The Wallet pass file header is invalid.')
			}
			const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
			if (start + compressed > zip.readUInt32LE(end + 16)) throw new Error('The Wallet pass file is truncated.')
			const data = zip.subarray(start, start + compressed)
			if (method !== 0 && method !== 8) throw new Error('The Wallet pass compression is unsupported.')
			const decoded = method === 8 ? await inflate(data, {maxOutputLength: MAX_PASS_BYTES}) : data
			if (decoded.length !== size) throw new Error('The Wallet pass file size is invalid.')
			const text = decoded.toString('utf8')
			JSON.parse(text)
			return text
		}
		offset = next
	}
	throw new Error('The Wallet pass has no pass.json.')
}
