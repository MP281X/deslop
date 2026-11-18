import {easBuildProfile, sourceSkips} from '@deslop/runtime/config/fingerprint'

export {sourceSkips}

// This pure helper is covered by the resolved expoConfig; keep plugin implementations and native sources hashed. Prebuild writes the share extension's Assets.xcassets from its icon, hashed below.
export const ignorePaths = ['../../packages/runtime/src/config/expo.ts', 'targets/share/Assets.xcassets/**']

// apple-targets builds every file in the share extension's folder, so a new one changes the native app.
export const extraSources = [
	easBuildProfile(import.meta.dirname),
	{filePath: 'targets/share', reasons: ['share extension'], type: 'dir'},
	{filePath: 'src/routes/icon.png', reasons: ['share extension icon'], type: 'file'}
]
