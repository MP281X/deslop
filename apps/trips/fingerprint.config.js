import {sourceSkips} from '@deslop/runtime/config/fingerprint'

export {sourceSkips}

// This pure helper is covered by the resolved expoConfig; keep plugin implementations and native sources hashed.
export const ignorePaths = ['../../packages/runtime/src/config/expo.ts']
