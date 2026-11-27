function targetConfig() {
	return {
		bundleIdentifier: '.activities',
		deploymentTarget: '26.0',
		displayName: 'Stash',
		frameworks: ['ActivityKit', 'SwiftUI', 'WidgetKit'],
		name: 'StashActivities',
		type: 'widget'
	}
}

export {targetConfig as 'module.exports'}
