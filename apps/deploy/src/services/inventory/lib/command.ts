import {Array, Boolean, Function, Match, Option, Record, String, pipe} from 'effect'

import type {ProcessLabel} from '#services/inventory/schema.ts'

// Each wrapper with the flags that take the next argument as their value, and how many arguments it reads before its command: timeout's duration.
const WRAPPERS: Record<string, {readonly operands: number; readonly values: readonly string[]}> = {
	env: {operands: 0, values: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string']},
	exec: {operands: 0, values: ['-a']},
	nice: {operands: 0, values: ['-n', '--adjustment']},
	nohup: {operands: 0, values: []},
	setsid: {operands: 0, values: []},
	stdbuf: {operands: 0, values: ['-i', '-o', '-e', '--input', '--output', '--error']},
	sudo: {
		operands: 0,
		values: [
			'-u',
			'--user',
			'-g',
			'--group',
			'-h',
			'--host',
			'-p',
			'--prompt',
			'-C',
			'--close-from',
			'-D',
			'--chdir',
			'-r',
			'--role',
			'-t',
			'--type',
			'-U',
			'--other-user',
			'-T',
			'--command-timeout'
		]
	},
	'systemd-run': {
		operands: 0,
		values: [
			'-u',
			'--unit',
			'-p',
			'--property',
			'-M',
			'--machine',
			'-E',
			'--setenv',
			'--slice',
			'--description',
			'--uid',
			'--gid',
			'--nice',
			'--working-directory',
			'-H',
			'--host'
		]
	},
	timeout: {operands: 1, values: ['-k', '--kill-after', '-s', '--signal']}
}
const SECRET = /(?:token|secret|passw(?:or)?d|key|auth|credential|cookie|session)/iu
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

// Flags, variables and headers named like secrets and the values after them or after an auth scheme, long opaque strings and URL credentials are masked, and each argument is capped.
export function maskArguments(args: readonly string[]) {
	return Array.map(args, (arg, index) => {
		if (Option.isSome(String.match(/^-{0,2}[\w.-]+=/u)(arg)) && SECRET.test(String.split(arg, '=')[0])) {
			return `${String.split(arg, '=')[0]}=…`
		}
		// A header written as one argument, such as `Authorization: Bearer …`.
		if (Option.isSome(String.match(/^[\w-]+:\s/u)(arg)) && SECRET.test(String.split(arg, ':')[0])) {
			return `${String.split(arg, ':')[0]}: …`
		}
		// A secret flag's or header's separate value, the credential after an auth scheme, or a long opaque argument; the executable and flags themselves stay readable.
		const previous = args[index - 1] ?? ''
		const secretValue =
			(String.startsWith('-')(previous) && !String.includes('=')(previous) && SECRET.test(previous)) ||
			(Option.isSome(String.match(/^[\w-]+:$/u)(previous)) && SECRET.test(previous)) ||
			Option.isSome(String.match(/^(?:bearer|basic|digest|token)$/iu)(previous))
		const opaque = !String.startsWith('/')(arg) && Option.isSome(String.match(/^[\w+/=-]{32,}$/u)(arg))
		if (index > 0 && (secretValue || (!String.startsWith('-')(arg) && opaque))) return '…'
		return String.slice(0, 200)(String.replaceAll(/:\/\/[^/@\s]+@/gu, '://…@')(arg))
	})
}

function alias(value: string) {
	return pipe(
		Match.value(value),
		Match.when('vite-plus', Function.constant('vp')),
		Match.orElse(() => value)
	)
}

// A script's words with their quotes and escapes taken off, so a quoted value stays one word.
function shellWords(script: string) {
	return pipe(
		Array.fromIterable(String.matchAll(/(?:[^\s'"\\]|\\.|'[^']*'?|"(?:[^"\\]|\\.)*"?)+/gsu)(script)),
		Array.map(word =>
			pipe(
				Array.fromIterable(String.matchAll(/'([^']*)'?|"((?:[^"\\]|\\.)*)"?|\\(.)|([^'"\\]+)/gsu)(word[0])),
				Array.map(piece => piece[1] ?? piece[3] ?? piece[4] ?? String.replaceAll(/\\(.)/gsu, '$1')(piece[2] ?? '')),
				Array.join('')
			)
		),
		Array.filter(String.isNonEmpty)
	)
}

// A shell's script: an exec launcher continues with its arguments; otherwise the exec segment, else the first that isn't setup, is the command, without quotes, redirections, `eval` or leading assignments. The script's words are masked like any command's arguments.
function shellRest(tokens: readonly string[]) {
	const script = pipe(tokens, Array.get(2), Option.getOrElse(Function.constant('')))
	const shifts = Option.match(String.match(/\bshift\b/gu)(script), {
		onNone: Function.constant(0),
		onSome: matches => matches.length
	})
	if (String.includes('exec "$@"')(script)) return Array.drop(tokens, 4 + shifts)
	const segments = pipe(
		maskArguments(shellWords(script)),
		Array.join(' '),
		String.replaceAll(/\d*[<>]+\|?\s*\S+/gu, ''),
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

// A wrapper's command: past its flags, their separate values, its own operands and env's assignments, or past `--`.
function wrapped(
	args: readonly string[],
	wrapper: {readonly operands: number; readonly values: readonly string[]}
): readonly string[] {
	return Option.match(Array.head(args), {
		onNone: () => args,
		onSome: token => {
			if (token === '--') return Array.drop(args, 1)
			if (Array.contains(wrapper.values, token)) return wrapped(Array.drop(args, 2), wrapper)
			if (isFlag(token) || assignment(token)) return wrapped(Array.drop(args, 1), wrapper)
			return Array.drop(args, wrapper.operands)
		}
	})
}

function unwrapTokens(tokens: readonly string[], cwd: Option.Option<string>): readonly string[] {
	const name = basename(Option.getOrElse(Array.head(tokens), Function.constant('')))
	const wrapper = WRAPPERS[name]
	if (wrapper !== undefined) return unwrapTokens(wrapped(Array.drop(tokens, 1), wrapper), cwd)
	if (Array.contains(SHELLS, name) && pipe(tokens, Array.get(1), Option.getOrElse(Function.constant(''))) === '-c') {
		return unwrapTokens(shellRest(tokens), cwd)
	}
	if (Array.contains(RUNTIMES, name)) {
		return pipe(
			tokens,
			Array.findFirstIndex((token, index) => index > 0 && !isFlag(token)),
			Option.match({
				onNone: () => tokens,
				onSome: index => {
					const script = pipe(tokens, Array.get(index), Option.getOrElse(Function.constant('')))
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
				Option.getOrElse(Function.constant('')),
				String.split(/\s+/u),
				Array.filter(String.isNonEmpty),
				maskArguments
			)
	})
	return unwrapTokens(
		[String.replace(/:$/u, '')(Option.getOrElse(Array.head(tokens), Function.constant(''))), ...Array.drop(tokens, 1)],
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
		return {detail: pipe(cwd, Option.map(basename), Option.getOrElse(Function.constant(''))), name}
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
						Boolean.match(String.isNonEmpty(remote.name), {
							onFalse: Function.constant(''),
							onTrue: () => `→ ${remote.name}`
						})
					],
					Array.filter(String.isNonEmpty),
					Array.join(' ')
				),
				name
			}
		}
	})
}
