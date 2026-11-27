const config = {
	// Expo hashes autolinked modules, but these extension targets are not modules.
	extraSources: [{filePath: 'targets', reasons: ['stash-extension-targets'], type: 'dir'}],
	// Prebuild writes the share icon set into targets/.
	ignorePaths: ['targets/share/Assets.xcassets/AppIcon.appiconset/**']
}

export {config as 'module.exports'}
