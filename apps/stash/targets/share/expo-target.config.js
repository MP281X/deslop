/** @param {import('expo/config').ExpoConfig & {ios: {bundleIdentifier: string}}} config */
function targetConfig(config) {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '18.0',
		displayName: 'stash',
		entitlements: {'keychain-access-groups': [`$(AppIdentifierPrefix)group.${config.ios.bundleIdentifier}`]},
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'Security', 'CoreText'],
		// The share sheet shows the extension's own icon, which apple-targets generates only from this path.
		icon: '../../src/routes/icon.png',
		name: 'StashShare',
		type: 'share'
	}
}

// apple-targets requires a function; Node's module.exports export exposes it directly to require().
export {targetConfig as 'module.exports'}
