// PreToolUse hook for AskUserQuestion: the question is allowed only after a ◼ state line was written in the current turn.
import {readFileSync} from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8'))
let seen = false
for (const line of readFileSync(input.transcript_path, 'utf8').split('\n')) {
	if (line === '') continue
	const entry = JSON.parse(line)
	const content = entry.message?.content ?? []
	if (entry.type === 'user' && entry.isSidechain !== true && !content.some?.(part => part.type === 'tool_result')) {
		seen = false
	}
	if (entry.type === 'assistant' && content.some(part => part.type === 'text' && part.text.includes('◼'))) seen = true
}
if (!seen) {
	console.log(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: 'Write the ◼ state line and the artifact as your message, then call this tool again.'
			}
		})
	)
}
