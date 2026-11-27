import {Effect} from 'effect'

import {RpcContracts} from '#contracts'

export const RpcHandlers = RpcContracts.toLayer({
	'items.list': () =>
		Effect.succeed([
			{id: 'first', title: 'First item', line: 'Example entry', body: 'This item is served by template-app.'},
			{id: 'second', title: 'Second item', line: 'Example entry', body: 'This item has its own link.'}
		])
})
