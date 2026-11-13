import {question} from '#lib/question.ts'

export const noContradictedPromise = question(
	'code',
	'Does a name `code` declares, a comment in `code`, or the operation a callback is handed to promise something the code next to it visibly contradicts?',
	{
		message:
			'Make the promise and the code agree: rename it, fix the comment, or move the side effect into its own command.',
		no: {
			cases: [
				'Names that are vague but not wrong',
				'Names a library or framework fixes, such as a `get` context in an atom or callback, even when it can also write',
				'A lint check that reports diagnostics or fixes: reporting is part of checking',
				'A noun-named atom, effect or service that performs the activity it names, and functions named and used as commands',
				'An Effect `code` returns for its caller to run, and writes to a value created inside the same function or callback',
				'A comment about a library default that explains why the code overrides it',
				'Claims about imported helpers or external systems, which `code` does not show',
				'Names and comments inside source text used as test fixtures, and parameters of short callbacks',
				'An is, has, can or should name given or returning a literal, template, object, array, arithmetic or new value: lint reports it'
			],
			example: `
				function isExpired(session: Session, now: number) {
					// Expires at the instant it reaches its deadline.
					return session.expiresAt <= now
				}
			`
		},
		yes: {
			cases: [
				'A get, find, is, has, to, format, parse or compute function that changes domain state, mutates its input, logs, sends a request or starts a timer, or returns something other than its name says',
				'A callback handed to map, filter, find, some, every, sort or a reducer that writes outside itself, sends or logs',
				'An is, has, can or should name holding a value that is not a boolean, such as a list or a count a call returns',
				'A plural name for one item, a singular name for a collection, or a name stating a unit, type or source the value does not have, such as seconds holding milliseconds',
				'A service list that streams rather than reads once, changes that holds a whole collection rather than diffs, or extra that holds one field: use list for a snapshot, watch for a collection stream, events for diffs and changed for a change notification',
				'An RPC tag whose prefix names a different service from the one its handler visibly dispatches to; the prefix names the answering service folder',
				'A comment naming a value, count, order or behavior that the code next to it does differently, such as "retries three times" above times: 5'
			],
			example: `
				function isExpired(sessions: Session[], now: number) {
					// Expires at the instant it reaches its deadline.
					return Array.filter(sessions, session => session.expiresAt < now)
				}
			`
		}
	}
)
