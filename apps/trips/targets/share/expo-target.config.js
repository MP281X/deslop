/** @param {import('expo/config').ExpoConfig} config */
function targetConfig(config) {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '26.0',
		displayName: config.slug,
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'ImageIO'],
		icon: '../../src/routes/icon.png',
		name: 'TripsShare',
		type: 'share'
	}
}

// apple-targets requires a function; Node's module.exports export exposes it directly to require().
export {targetConfig as 'module.exports'}
