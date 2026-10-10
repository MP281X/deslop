import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

// The server and the published CLI bundle here; EAS and Metro build the iOS client from the same folder.
// ONNX Runtime and sharp load native binaries, and onnxruntime-common must be the instance onnxruntime-node checks
// tensors against, so they stay installed. Transformers.js is bundled because it imports onnxruntime-common without
// declaring it, which strict pnpm installs cannot resolve.
export default defineConfig({
	pack: {
		...ViteConfig.pack,
		deps: {alwaysBundle: [/^(?!onnxruntime-|sharp$)/u]},
		entry: {cli: 'src/main.cli.ts', server: 'src/main.ts'},
		outputOptions: {entryFileNames: '[name].js'}
	}
})
