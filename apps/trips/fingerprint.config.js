// Expo autolinks the app module, but apple-targets builds Swift outside the generated ios/ tree.
export const ignorePaths = ['targets/share/Assets.xcassets/**']
export const extraSources = [
	{filePath: 'targets', reasons: ['Trips share and WidgetKit targets'], type: 'dir'},
	{filePath: 'modules', reasons: ['Trips Live Activity Expo module'], type: 'dir'},
	{filePath: 'public/apple-touch-icon.png', reasons: ['Trips share icon'], type: 'file'}
]
