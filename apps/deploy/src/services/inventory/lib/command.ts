import {Array, Boolean, Match, Option, Record, String, pipe} from 'effect'

import type {ProcessLabel} from '#services/inventory/schema.ts'

const WRAPPERS = ['env', 'nice', 'nohup', 'setsid', 'exec', 'timeout', 'sudo', 'stdbuf', 'systemd-run']
const RUNTIMES = ['node', 'bun', 'deno', 'python', 'python3']
const SHELLS = ['sh', 'bash', 'zsh', 'dash']
// Shell setup that runs before the command, such as an agent's snapshot `source`, `shopt` and `\builtin unalias` lines.
const SETUP = ['source', '.', 'shopt', 'set', 'export', 'cd', 'true', 'unset', 'alias', 'pwd', '{', '}', '\\builtin']
const SUBJECT: Record<string, readonly string[]> = {
	'chrome-headless-shell': ['type'],
	claude: ['model', 'effort', 'resume'],
	codex: ['model'],
	vp: ['filter']
}

type Values = Record<string, string>
type Scan = {
	readonly words: readonly string[]
	readonly values: Values
	readonly ssh: Option.Option<{readonly host: string; readonly remote: readonly string[]}>
}

function basename(value: string) {
	return Option.getOrElse(Array.last(pipe(value, String.split('/'), Array.filter(String.isNonEmpty))), () => value)
}

function isFlag(token: string) {
	return String.startsWith('-')(token) && token !== '-' && token !== '--'
}

function assignment(token: string) {
	return Option.isSome(String.match(/^\w+=/u)(token))
}

function capture(pattern: RegExp, value: string) {
	return Option.flatMap(String.match(pattern)(value), match => Option.fromUndefinedOr(match[1]))
}

// A flag's name and the value written after `=`, when there is one.
function flagParts(token: string) {
	return Option.match(String.match(/^([^=]*)(?:=(.*))?$/su)(String.replace(/^-+/u, '')(token)), {
		onNone: () => ({flag: '', inline: Option.none<string>()}),
		onSome: match => ({flag: match[1] ?? '', inline: Option.fromUndefinedOr(match[2])})
	})
}

function alias(value: string) {
	return pipe(
		Match.value(value),
		Match.when('vite-plus', () => 'vp'),
		Match.orElse(() => value)
	)
}

// A shell's script: an exec launcher continues with its arguments; otherwise the exec segment, else the first that isn't setup, is the command, without quotes, redirections, `eval` or leading assignments.
function shellRest(tokens: readonly string[]) {
	const script = pipe(
		tokens,
		Array.get(2),
		Option.getOrElse(() => '')
	)
	const shifts = Option.match(String.match(/\bshift\b/gu)(script), {onNone: () => 0, onSome: matches => matches.length})
	if (String.includes('exec "$@"')(script)) return Array.drop(tokens, 4 + shifts)
	const segments = pipe(
		String.replaceAll(/\d*[<>]+\|?\s*\S+/gu, '')(String.replaceAll(/['"]/gu, '')(script)),
		String.split(/\s*(?:\|\|?|;|&&)\s*/u),
		Array.map(segment =>
			pipe(String.replace(/^eval\s+/u, '')(String.trim(segment)), String.split(/\s+/u), Array.dropWhile(assignment))
		),
		Array.filter(words => String.isNonEmpty(words[0] ?? ''))
	)
	return pipe(
		Array.findFirst(segments, words => words[0] === 'exec'),
		Option.map(words => Array.drop(words, 1)),
		Option.orElse(() => Array.findFirst(segments, words => !Array.contains(SETUP, words[0] ?? ''))),
		Option.getOrElse(() => Array.take(tokens, 1))
	)
}

function unwrapTokens(tokens: readonly string[], cwd: Option.Option<string>): readonly string[] {
	const name = basename(Option.getOrElse(Array.head(tokens), () => ''))
	if (Array.contains(WRAPPERS, name)) {
		return unwrapTokens(
			pipe(
				Array.findFirstIndex(tokens, token => token === '--'),
				Option.filter(index => index > 0),
				Option.match({
					onNone: () => {
						const tail = Array.drop(tokens, 1)
						return pipe(
							tail,
							Array.findFirstIndex(token => !isFlag(token) && !assignment(token)),
							Option.match({
								onNone: () => Array.empty<string>(),
								onSome: start =>
									Array.filter(tail, (token, index) => index >= start && !isFlag(token) && !assignment(token))
							})
						)
					},
					onSome: index => Array.drop(tokens, index + 1)
				})
			),
			cwd
		)
	}
	if (
		Array.contains(SHELLS, name) &&
		pipe(
			tokens,
			Array.get(1),
			Option.getOrElse(() => '')
		) === '-c'
	) {
		return unwrapTokens(shellRest(tokens), cwd)
	}
	if (Array.contains(RUNTIMES, name)) {
		return pipe(
			tokens,
			Array.findFirstIndex((token, index) => index > 0 && !isFlag(token)),
			Option.match({
				onNone: () => tokens,
				onSome: index => {
					const script = pipe(
						tokens,
						Array.get(index),
						Option.getOrElse(() => '')
					)
					// The innermost package, past pnpm's and Bun's `.pnpm` and `.bun` stores.
					const pkg = capture(/.*node_modules\/((?:@[^/]+\/)?[^/.][^/]*)\//u, script)
					const app = Option.orElse(capture(/\.deslop\/([^/]+)\//u, script), () =>
						Option.flatMap(cwd, value => capture(/\/apps\/([^/]+)$/u, value))
					)
					return [
						pipe(
							pkg,
							Option.orElse(() => app),
							Option.getOrElse(() => basename(script))
						),
						...Array.drop(tokens, index + 1)
					]
				}
			})
		)
	}
	return tokens
}

// Chrome and sshd rewrite their arguments into one string; a trailing colon on the program is noise.
function unwrap(argv: readonly string[], cwd: Option.Option<string>) {
	const tokens = Boolean.match(Array.length(argv) === 1, {
		onFalse: () => argv,
		onTrue: () =>
			pipe(
				Array.head(argv),
				Option.getOrElse(() => ''),
				String.split(/\s+/u),
				Array.filter(String.isNonEmpty)
			)
	})
	return unwrapTokens(
		[String.replace(/:$/u, '')(Option.getOrElse(Array.head(tokens), () => '')), ...Array.drop(tokens, 1)],
		cwd
	)
}

// The words and subject values left after flags, flag values and opaque tokens are dropped; ssh stops at its host.
function scan(
	name: string,
	subject: readonly string[],
	args: readonly string[],
	words: readonly string[],
	values: Values
): Scan {
	return Option.match(Array.head(args), {
		onNone: () => ({ssh: Option.none(), values, words}),
		onSome: token => {
			if (isFlag(token)) {
				const parsed = flagParts(token)
				const next = pipe(
					args,
					Array.get(1),
					Option.filter(value => !isFlag(value))
				)
				const value = Option.orElse(parsed.inline, () => next)
				return scan(
					name,
					subject,
					Boolean.match(Option.isNone(parsed.inline) && Option.isSome(next), {
						onFalse: () => Array.drop(args, 1),
						onTrue: () => Array.drop(args, 2)
					}),
					words,
					pipe(
						subject,
						Array.contains(parsed.flag),
						Boolean.match({
							onFalse: () => values,
							onTrue: () =>
								Boolean.match(parsed.flag === 'resume', {
									onFalse: () =>
										Option.match(value, {
											onNone: () => values,
											onSome: given => Record.set(values, parsed.flag, given)
										}),
									onTrue: () => Record.set(values, parsed.flag, 'resumed')
								})
						})
					)
				)
			}
			if (name === 'ssh') {
				return {
					ssh: Option.some({
						host: Option.getOrElse(Array.last(String.split(token, '@')), () => token),
						remote: Array.drop(args, 1)
					}),
					values,
					words
				}
			}
			if (
				token === '…' ||
				String.length(token) > 40 ||
				Option.isSome(String.match(/^[0-9a-f-]{16,}$/iu)(token)) ||
				String.includes('=')(token)
			) {
				return scan(name, subject, Array.drop(args, 1), words, values)
			}
			const word = Boolean.match(String.includes('/')(token), {onFalse: () => token, onTrue: () => basename(token)})
			return scan(name, subject, Array.drop(args, 1), [...words, word], values)
		}
	})
}

export function commandLabel(argv: readonly string[], cwd: Option.Option<string>): ProcessLabel {
	const [head = '', ...args] = unwrap(argv, cwd)
	const name = alias(basename(head))
	const subject = pipe(
		SUBJECT,
		Record.get(name),
		Option.getOrElse(() => Array.empty<string>())
	)
	const scanned = scan(name, subject, args, [], {})
	// An interactive shell, such as a terminal tab, runs no script: where it sits tells it apart.
	if (Array.contains(SHELLS, name) && Array.isReadonlyArrayEmpty(scanned.words)) {
		return {
			detail: pipe(
				cwd,
				Option.map(basename),
				Option.getOrElse(() => '')
			),
			name
		}
	}
	return Option.match(scanned.ssh, {
		onNone: () => ({
			detail: Array.join(
				[
					...Array.take(scanned.words, 2),
					...Array.filter(
						Array.getSomes(Array.map(subject, flag => Record.get(scanned.values, flag))),
						String.isNonEmpty
					)
				],
				' '
			),
			name
		}),
		onSome: ssh => {
			const remote = commandLabel(ssh.remote, Option.none())
			return {
				detail: pipe(
					[
						ssh.host,
						Boolean.match(String.isNonEmpty(remote.name), {onFalse: () => '', onTrue: () => `→ ${remote.name}`})
					],
					Array.filter(String.isNonEmpty),
					Array.join(' ')
				),
				name
			}
		}
	})
}
