import {Effect, Stream} from 'effect'

import {ChildProcess} from 'effect/process'

import {AppError} from '#cli/schema.ts'

export const execute = Effect.fnUntraced(function* (command: string, args: string[]) {
	const process = yield* ChildProcess.make(command, args, {stderr: 'pipe', stdout: 'pipe'})
	const result = yield* Effect.all(
		{
			code: process.exitCode,
			stderr: Stream.mkString(Stream.decodeText(process.stderr)),
			stdout: Stream.mkString(Stream.decodeText(process.stdout))
		},
		{concurrency: 'unbounded'}
	)
	if (result.code !== 0) return yield* AppError.make({message: `${command} failed: ${result.stderr}`})
	return result.stdout
}, Effect.scoped)
