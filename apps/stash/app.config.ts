import * as ExpoRuntime from '@deslop/runtime/mobile/expo'

const app = ExpoRuntime.make({projectId: 'c9620553-0dc5-4e08-b691-a47fa3cab00e', slug: 'stash'})

export default {
	...app.config,
	ios: {
		...app.config.ios,
		entitlements: {
			'com.apple.security.application-groups': [app.appGroup],
			'keychain-access-groups': [`$(AppIdentifierPrefix)${app.appGroup}`]
		},
		infoPlist: {DeslopKeychainGroup: `$(AppIdentifierPrefix)${app.appGroup}`}
	},
	plugins: [...app.config.plugins, '@bacons/apple-targets']
}
