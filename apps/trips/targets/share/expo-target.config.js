/** @param {import('expo/config').ExpoConfig & {ios: {bundleIdentifier: string}}} config */
function targetConfig(config) {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '26.0',
		displayName: config.slug,
		// The app saves its session in this group, so a share sends it too.
		entitlements: {'keychain-access-groups': [`$(AppIdentifierPrefix)group.${config.ios.bundleIdentifier}`]},
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'ImageIO', 'Security'],
		icon: '../../src/routes/icon.png',
		name: 'TripsShare',
		type: 'share'
	}
}

// apple-targets requires a function; Node's module.exports export exposes it directly to require().
export {targetConfig as 'module.exports'}
