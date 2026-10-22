import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

export default defineConfig({
	pack: {...ViteConfig.pack, entry: {server: 'src/main.server.ts'}, outputOptions: {entryFileNames: '[name].js'}}
})
