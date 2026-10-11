import {defineConfig} from 'vite-plus'

import * as ViteConfig from '@deslop/runtime/vite'

// The server and the published CLI bundle here; EAS and Metro build the iOS client from the same folder.
// ONNX Runtime and sharp load native binaries, and onnxruntime-common must be the instance onnxruntime-node checks
// tensors against, so they stay external and load from the repository's install, where the server runs. They are
// devDependencies, so the published CLI does not download them. Transformers.js is bundled because it imports
// onnxruntime-common without declaring it, which strict pnpm installs cannot resolve.
export default defineConfig({
	pack: {
		...ViteConfig.pack,
		deps: {alwaysBundle: [/^(?!onnxruntime-|sharp$)/u], neverBundle: [/^onnxruntime-/u, 'sharp']},
		entry: {cli: 'src/main.cli.ts', server: 'src/main.ts'},
		outputOptions: {entryFileNames: '[name].js'}
	}
})
