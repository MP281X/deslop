import {Boolean, Effect} from 'effect'

import {registerPlugin} from '@capacitor/core'

import {isNative, nativeServer} from '@deslop/ui/native'

/* oxlint-disable typescript/no-restricted-types -- Capacitor's bridge returns Promises. */
const gateway = registerPlugin<{copy: (options: {url: string}) => Promise<void>}>('Gateway')
/* oxlint-enable typescript/no-restricted-types */

export const gatewayOrigin = Boolean.match(isNative, {
	onFalse: () => Effect.sync(() => location.origin),
	onTrue: () => nativeServer
})

export function copyMcpUrl(origin: string) {
	const url = `${origin}/mcp`
	if (isNative) return gateway.copy({url})
	return navigator.clipboard.writeText(url)
}
