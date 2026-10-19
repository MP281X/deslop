import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

// ONNX Runtime and sharp load native binaries, so the server loads them from the repository's install.
export default defineConfig({
	pack: {
		...ViteConfig.pack,
		deps: {alwaysBundle: [/^(?!onnxruntime-|sharp$)/u], neverBundle: [/^onnxruntime-/u, 'sharp']}
	}
})
