import {assert, it} from '@effect/vitest'

import {Option, String} from 'effect'

import {clientMetadata, serverIcons, serverName} from './metadata.ts'

it('names a server by the first label of its host, safe inside a tool name', () => {
	assert.strictEqual(serverName('https://mcp.Example_Corp.com/v1'), 'example-corp')
	assert.strictEqual(serverName('https://api.a-very-long-provider-name.com'), 'a-very-long-prov')
	assert.strictEqual(serverName('https://-edge-.example.com'), 'edge')
})

it('keeps at most two small icons a page can show', () => {
	assert.deepStrictEqual(
		serverIcons(
			Option.some({
				icons: [
					{src: 'http://insecure.example.test/a.png'},
					{src: `data:image/png;base64,${String.repeat(32_768)('A')}`},
					{src: 'https://example.test/a.png', theme: 'dark'},
					{src: 'data:image/png;base64,AAAA'},
					{src: 'https://example.test/c.png'}
				],
				name: 'example',
				version: '1'
			})
		),
		[
			{src: 'https://example.test/a.png', theme: Option.some('dark')},
			{src: 'data:image/png;base64,AAAA', theme: Option.none()}
		]
	)
	assert.deepStrictEqual(serverIcons(Option.none()), [])
})

it('describes the gateway’s client by the addresses it serves', () => {
	const client = clientMetadata('https://gateway.example.test')
	assert.strictEqual(client.client_id, 'https://gateway.example.test/oauth/client.json')
	assert.deepStrictEqual(client.redirect_uris, ['https://gateway.example.test/oauth/callback'])
})
