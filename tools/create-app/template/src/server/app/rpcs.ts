import {Effect} from 'effect'

import {RpcContracts} from '#contracts'

export const RpcHandlers = RpcContracts.toLayer({
	'items.list': () =>
		Effect.succeed([
			{body: 'This item is served by template-app.', id: 'first', line: 'Example entry', title: 'First item'},
			{body: 'This item has its own link.', id: 'second', line: 'Example entry', title: 'Second item'}
		])
})
