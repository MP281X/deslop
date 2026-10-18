import * as ExpoRuntime from '@deslop/runtime/mobile/expo'

const app = ExpoRuntime.make({
	bundleIdentifier: 'xyz.mp281x.stash',
	name: 'stash',
	owner: 'mp281x.xyz',
	projectId: 'c9620553-0dc5-4e08-b691-a47fa3cab00e',
	server: 'https://stash.mp281x.xyz',
	slug: 'stash'
})

export default {
	...app.config,
	ios: {
		...app.config.ios,
		entitlements: {'com.apple.security.application-groups': [app.appGroup]},
		infoPlist: {StashServer: app.config.extra.server}
	},
	plugins: [...app.config.plugins, '@bacons/apple-targets']
}
