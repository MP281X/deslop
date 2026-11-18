import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {ipv4Reachable, lsofSockets, socketLine} from './sockets.ts'

it('reads a quoted process name and keeps a dual-stack wildcard within loopback reach', () => {
	const socket = Option.getOrThrow(socketLine('tcp LISTEN 0 5 *:31000 *:* users:(("name"quote",pid=111,fd=5))'))
	assert.deepStrictEqual(
		Option.map(socket.process, process => process.name),
		Option.some('name"quote')
	)
	assert.isTrue(ipv4Reachable(socket.address))
	assert.isFalse(ipv4Reachable('[::]:31000'))
	assert.isFalse(ipv4Reachable('[::1]:31000'))
})

it('lists each of a process’s descriptors that lsof separates', () => {
	assert.deepStrictEqual(
		Array.map(
			lsofSockets(
				'p12\ncCafé Test\nf10\ntIPv4\nPTCP\nn127.0.0.1:31000\nTST=LISTEN\nf11\ntIPv4\nPTCP\nn127.0.0.1:31001\nTST=LISTEN\n'
			),
			socket => socket.port
		),
		[31_000, 31_001]
	)
})
