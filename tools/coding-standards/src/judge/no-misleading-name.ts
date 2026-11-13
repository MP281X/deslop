import {question} from '#lib/question.ts'

export const noMisleadingName = question(
	'code',
	'Does a name `code` declares promise something its own value or behavior visibly contradicts?',
	{
		message: 'Rename it to say what it is or does.',
		no: {
			cases: [
				'Names that are vague but not wrong',
				'Names a library or framework fixes, such as a `get` context in an atom or callback, even when it can also write',
				'A lint check that reports diagnostics or fixes: reporting is part of checking',
				'A noun-named atom, effect or service that performs the activity it names',
				'Names inside source text used as test fixtures',
				'Parameters of short callbacks',
				'An is, has, can or should name given or returning a literal, template, object, array, arithmetic or new value: lint reports it'
			],
			example: `
				function isExpired(session: Session, now: number) {
					return session.expiresAt < now
				}
			`
		},
		yes: {
			cases: [
				'A get, find, is, has or to function `code` declares that changes domain state, or returns something other than its name says',
				'An is, has, can or should name holding a value that is not a boolean, such as a list or a count a call returns',
				'A plural name for one item, or a singular name for a collection',
				'A name stating a unit, type or source the value does not have, such as seconds holding milliseconds',
				'A service list that streams rather than reads once, changes that holds a whole collection rather than diffs, or extra that holds one field: use list for a snapshot, watch for a collection stream, events for diffs and changed for a change notification',
				'An RPC tag whose prefix names a different service from the one its handler visibly dispatches to; the prefix names the answering service folder'
			],
			example: `
				function isExpired(sessions: Session[], now: number) {
					return Array.filter(sessions, session => session.expiresAt < now)
				}
			`
		}
	}
)
