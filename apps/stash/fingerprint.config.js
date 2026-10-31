// The package.json scripts run JavaScript tooling only, so changing them rebuilds no native app.
export const sourceSkips = ['PackageJsonScriptsAll']

// File by file, because prebuild writes the share extension's generated Assets.xcassets into targets/share.
export const extraSources = [
	{filePath: 'targets/share/Info.plist', reasons: ['share extension'], type: 'file'},
	{filePath: 'targets/share/SessionLock.swift', reasons: ['share extension'], type: 'file'},
	{filePath: 'targets/share/ShareViewController.swift', reasons: ['share extension'], type: 'file'},
	{filePath: 'targets/share/expo-target.config.js', reasons: ['share extension'], type: 'file'},
	{filePath: 'src/routes/icon.png', reasons: ['share extension icon'], type: 'file'}
]
