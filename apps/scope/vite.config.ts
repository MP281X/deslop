import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

export default defineConfig({pack: {...ViteConfig.pack, deps: {alwaysBundle: [/./u]}}})
