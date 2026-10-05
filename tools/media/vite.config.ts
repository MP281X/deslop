import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		// ONNX Runtime and sharp load native binaries, and onnxruntime-common must be the instance onnxruntime-node checks
		// tensors against, so they stay installed. Transformers.js is bundled because it imports onnxruntime-common
		// without declaring it, which strict pnpm installs cannot resolve.
		deps: {alwaysBundle: [/^(?!onnxruntime-|sharp$)/u]},
		entry: ['src/cli.ts'],
		outputOptions: {entryFileNames: '[name].js'}
	}
})
