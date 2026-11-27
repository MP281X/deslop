// Expo hashes autolinked modules, but these extension targets are not modules.
const config = {extraSources: [{filePath: 'targets', reasons: ['stash-extension-targets'], type: 'dir'}]}

export {config as 'module.exports'}
