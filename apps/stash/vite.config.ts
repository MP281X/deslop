import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

// Only the server bundles here, with the runtime's shared settings.
export default defineConfig({pack: ViteConfig.pack})
