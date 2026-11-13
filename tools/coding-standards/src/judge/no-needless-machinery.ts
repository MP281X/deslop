import {changeQuestion} from '#lib/question.ts'

export const noNeedlessMachinery = changeQuestion(
	'edit',
	'Does `edit`, a hunk of the change to `file`, add machinery the code does not need: a wrapper that hides a library or takes over its options, a helper or layer whose one use reads as clearly without it, fixed steps or handlers written as data and interpreted, a state machine or mode flag for plain state, or a second owner for state or a policy another module already owns?',
	{
		message:
			'Delete the machinery and write the direct form: call the library, inline the one use, or read the state from its one owner.',
		no: {
			cases: [
				'A helper that packages several concerns behind one small call and still composes with the library’s own pieces',
				'A lookup table, schema, route or configuration a library reads',
				'A module the hunk removes, or code moved without new machinery',
				'Machinery whose second use or capability the hunk shows, and documentation or tests',
				'A one-line pass-through, an exact forwarding or a value used once: lint reports these'
			],
			example: {
				edit: `
					@@ export const connectionsAtom = Atom.family((machine: Machine) =>
					-	Atom.keepAlive(liveAtom(RpcClient, 'connections.watch', {machine}))
					+	Atom.keepAlive(liveAtom(RpcClient, 'connections.watch', {machine, includeIdle: true}))
					 )
				`,
				file: 'apps/deploy/src/lib/atoms.ts'
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
				edit: `
					@@ import {RpcClient} from '#lib/client.ts'
					+export function rpcAtom(tag: string, input: unknown, options?: {keepAlive?: boolean; refresh?: Duration.Input}) {
					+	const atom = RpcClient.query(tag, input, {reactivityKeys: [tag]})
					+	if (options?.refresh !== undefined) Atom.refreshOnInterval(atom, options.refresh)
					+	if (options?.keepAlive) return Atom.keepAlive(atom)
					+	return atom
					+}
					+
					+export const notesAtom = rpcAtom('notes.list', {}, {keepAlive: true})
				`,
				file: 'apps/stash/src/lib/atoms.ts'
			}
		}
	}
)
