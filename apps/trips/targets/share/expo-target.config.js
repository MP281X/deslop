function targetConfig() {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '26.0',
		displayName: 'trips',
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'ImageIO'],
		icon: '../../src/routes/icon.png',
		name: 'TripsShare',
		type: 'share'
	}
}

export {targetConfig as 'module.exports'}
