/** @param {import('expo/config').ExpoConfig & {ios: {bundleIdentifier: string}}} config */
function targetConfig(config) {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '26.0',
		displayName: 'Stash',
		entitlements: {
			'com.apple.security.application-groups': [`group.${config.ios.bundleIdentifier}`],
			'keychain-access-groups': [`$(AppIdentifierPrefix)group.${config.ios.bundleIdentifier}`]
		},
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'Security', 'ImageIO'],
		// The share sheet shows the extension's own icon, which apple-targets generates only from this path.
		icon: './icon.png',
		name: 'StashShare',
		type: 'share'
	}
}

// apple-targets requires a function; Node's module.exports export exposes it directly to require().
export {targetConfig as 'module.exports'}
