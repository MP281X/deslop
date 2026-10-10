// The share extension is native code that Expo's fingerprint does not read, so a change to it needs a new build
// instead of an EAS Update. @expo/fingerprint requires this file and reads its named exports.
export const extraSources = [{filePath: 'targets/share', reasons: ['share extension'], type: 'dir'}]
