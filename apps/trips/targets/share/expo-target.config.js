/** @param {import('expo/config').ExpoConfig & {ios: {bundleIdentifier: string}}} config */
function targetConfig(config) {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '26.0',
		displayName: config.name,
		entitlements: {'keychain-access-groups': [`99K7MQUK7F.group.${config.ios.bundleIdentifier}`]},
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'ImageIO', 'Security'],
		icon: '../../public/apple-touch-icon.png',
		name: 'TripsShare',
		type: 'share'
	}
}

export {targetConfig as 'module.exports'}
