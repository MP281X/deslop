import {Array, pipe} from 'effect'

import {sourceSkips} from '@deslop/runtime/config/fingerprint'

export {sourceSkips}

// This pure helper is covered by the resolved expoConfig; keep plugin implementations and native sources hashed.
export const ignorePaths = ['../../packages/runtime/src/config/expo.ts']

// File by file, because prebuild writes the share extension's generated Assets.xcassets into targets/share.
export const extraSources = pipe(
	['targets/share/Info.plist', 'targets/share/ShareViewController.swift', 'targets/share/expo-target.config.js'],
	Array.map(filePath => ({filePath, reasons: ['share extension'], type: 'file'})),
	Array.append({filePath: 'src/routes/icon.png', reasons: ['share extension icon'], type: 'file'})
)
