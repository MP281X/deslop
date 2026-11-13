import {changeQuestion} from '#lib/question.ts'

export const noNeedlessMachinery = changeQuestion(
	'change',
	'Does `change`, the whole diff of what `request` asks for, add machinery the code does not need: a wrapper that hides a library or takes over its options, a helper or layer whose one use reads as clearly without it, fixed steps or handlers written as data and interpreted, a state machine or mode flag for plain state, or a second owner for state or a policy another module already owns? `context` lists lines outside the diff that declare or use the names `request` mentions.',
	{
		message:
			'Delete the machinery and write the direct form: call the library, inline the one use, or read the state from its one owner.',
		no: {
			cases: [
				'A helper that packages several concerns behind one small call and still composes with the library’s own pieces',
				'A lookup table, schema, route or configuration a library reads',
				'A module the change removes, or code moved without new machinery',
				'Machinery whose second use or capability the change shows, and documentation or tests',
				'A one-line pass-through, an exact forwarding or a value used once: lint reports these'
			],
			example: {
				change: `
					Changed files:
					M apps/deploy/src/lib/atoms.ts

					=== apps/deploy/src/lib/atoms.ts
					@@ -8,3 +8,3 @@ export const connectionsAtom = Atom.family((machine: Machine) =>
					-	Atom.keepAlive(liveAtom(RpcClient, 'connections.watch', {machine}))
					+	Atom.keepAlive(liveAtom(RpcClient, 'connections.watch', {machine, includeIdle: true}))
					 )
				`,
				context: '',
				request: 'Deploy lists idle connections too'
			}
		},
		yes: {
			cases: [
				'A function wrapping a library call that renames it or picks its options for every caller, such as an atom factory with its own keepAlive and refresh flags',
				'A list of step objects run through a loop or switch, where the steps are fixed',
				'A status union, reducer or flag that tracks what one value or one library result already says',
				'A second cache, store or copy of a policy for something another module already owns'
			],
			example: {
				change: `
					Changed files:
					M apps/stash/src/lib/atoms.ts

					=== apps/stash/src/lib/atoms.ts
					@@ -1,3 +1,11 @@ import {RpcClient} from '#lib/client.ts'
					+export function rpcAtom(tag: string, input: unknown, options?: {keepAlive?: boolean; refresh?: Duration.Input}) {
					+	const atom = RpcClient.query(tag, input, {reactivityKeys: [tag]})
					+	if (options?.refresh !== undefined) Atom.refreshOnInterval(atom, options.refresh)
					+	if (options?.keepAlive) return Atom.keepAlive(atom)
					+	return atom
					+}
					+
					+export const notesAtom = rpcAtom('notes.list', {}, {keepAlive: true})
				`,
				context: '',
				request: 'Stash keeps the notes list loaded between pages'
			}
		}
	}
)
