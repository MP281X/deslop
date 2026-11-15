// oxlint-disable-next-line @deslop/coding-standards/no-pass-through-name -- apple-targets requires a function exported through module.exports.
function targetConfig() {
	return {
		bundleIdentifier: '.share',
		deploymentTarget: '26.0',
		displayName: 'stash',
		frameworks: ['SwiftUI', 'UIKit', 'UniformTypeIdentifiers', 'CoreText'],
		// The share sheet shows the extension's own icon, which apple-targets generates only from this path.
		icon: '../../src/routes/icon.png',
		name: 'StashShare',
		type: 'share'
	}
}

// apple-targets requires a function; Node's module.exports export exposes it directly to require().
export {targetConfig as 'module.exports'}
