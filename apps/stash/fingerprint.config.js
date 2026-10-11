// The share extension and the pnpm patches change native code that Expo's fingerprint does not read, so a change to
// either needs a new build instead of an EAS Update. @expo/fingerprint requires this file and reads its named exports.
export const extraSources = [
	{filePath: 'targets/share', reasons: ['share extension'], type: 'dir'},
	{filePath: '../../patches', reasons: ['native patches of dependencies'], type: 'dir'}
]
