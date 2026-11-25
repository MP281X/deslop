import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {socketLine} from './sockets.ts'
import {ipv4Reachable} from './utils.ts'

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
