import {sourceSkips} from '@deslop/runtime/config/fingerprint'

export {sourceSkips}

// This pure helper is covered by the resolved expoConfig; keep plugin implementations and native sources hashed.
export const ignorePaths = ['../../packages/runtime/src/config/expo.ts']

// File by file, because prebuild writes the share extension's generated Assets.xcassets into targets/share.
export const extraSources = [
	{filePath: 'targets/share/Info.plist', reasons: ['share extension'], type: 'file'},
	{filePath: 'targets/share/ShareViewController.swift', reasons: ['share extension'], type: 'file'},
	{filePath: 'targets/share/expo-target.config.js', reasons: ['share extension'], type: 'file'},
	{filePath: 'src/routes/icon.png', reasons: ['share extension icon'], type: 'file'}
]
