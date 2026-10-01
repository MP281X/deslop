import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

export class AiError extends Schema.TaggedError<AiError>()('AiError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type AiStatus = typeof AiStatus.Type
export const AiStatus = Schema.Literals(['idle', 'running', 'stopping', 'error'] as const)

export type AiAgent = typeof AiAgent.Type
export const AiAgent = Schema.Literals(['pi'] as const)

export type AiSessionId = typeof AiSessionId.Type
export const AiSessionId = Schema.Struct({agent: AiAgent, id: Schema.String})

export type AiSkill = typeof AiSkill.Type
export const AiSkill = Schema.Struct({
	description: Schema.String,
	instructions: Schema.String,
	name: Schema.String,
	resources: Schema.optional(Schema.Record(Schema.String, Schema.String))
})

export type AiAgentDefinition = typeof AiAgentDefinition.Type
export const AiAgentDefinition = Schema.Struct({
	description: Schema.String,
	instructions: Schema.String,
	name: Schema.String,
	skills: Schema.Array(AiSkill),
	tools: Schema.Array(Schema.String)
})

export type AiModel = typeof AiModel.Type
export const AiModel = Schema.Struct({
	id: Schema.Literals(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] as const),
	provider: Schema.Literals(['openai-codex'] as const),
	reasoning: Schema.Literals(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)
})

export const Read = Tool.make('read', {
	description: 'Read a text file. Use offset and limit to read large files in sections.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		limit: Schema.optional(Schema.Finite.annotate({description: 'Maximum number of lines to return'})),
		offset: Schema.optional(Schema.Finite.annotate({description: 'First line to return, starting at 1'})),
		path: Schema.String.annotate({description: 'File path, relative to the configured working directory or absolute'})
	}),
	success: Schema.String
})

export const Write = Tool.make('write', {
	description: 'Write a complete text file, creating its parent directories and replacing existing content.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		content: Schema.String.annotate({description: 'Complete file content'}),
		path: Schema.String.annotate({description: 'File path, relative to the configured working directory or absolute'})
	}),
	success: Schema.String
})

export const Edit = Tool.make('edit', {
	description: 'Edit one text file with exact, unique text replacements.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		edits: Schema.Array(
			Schema.Struct({
				newText: Schema.String.annotate({description: 'Replacement text'}),
				oldText: Schema.String.annotate({description: 'Exact text that must occur once'})
			})
		).annotate({description: 'Exact replacements applied in order'}),
		path: Schema.String.annotate({description: 'File path, relative to the configured working directory or absolute'})
	}),
	success: Schema.String
})

export const Bash = Tool.make('bash', {
	description: 'Execute a shell command in the configured working directory and return combined output.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		command: Schema.String.annotate({description: 'Shell command to execute'}),
		timeout: Schema.optional(Schema.Finite.annotate({description: 'Optional timeout in seconds'}))
	}),
	success: Schema.String
})

export const Grep = Tool.make('grep', {
	description: 'Search text files and return matching paths, line numbers, and lines.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		glob: Schema.optional(Schema.String.annotate({description: 'File glob, such as **/*.ts'})),
		ignoreCase: Schema.optional(Schema.Boolean.annotate({description: 'Use case-insensitive matching'})),
		limit: Schema.optional(Schema.Finite.annotate({description: 'Maximum number of matches'})),
		literal: Schema.optional(Schema.Boolean.annotate({description: 'Treat pattern as literal text'})),
		path: Schema.optional(Schema.String.annotate({description: 'File or directory to search'})),
		pattern: Schema.String.annotate({description: 'Regular expression or literal search text'})
	}),
	success: Schema.String
})

export const Find = Tool.make('find', {
	description: 'Find files using a glob and return paths relative to the search directory.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		limit: Schema.optional(Schema.Finite.annotate({description: 'Maximum number of paths'})),
		path: Schema.optional(Schema.String.annotate({description: 'Directory to search'})),
		pattern: Schema.String.annotate({description: 'File glob, such as **/*.ts'})
	}),
	success: Schema.String
})

export const Ls = Tool.make('ls', {
	description: 'List a directory alphabetically, adding a slash to directory names.',
	failure: Schema.Defect(),
	parameters: Schema.Struct({
		limit: Schema.optional(Schema.Finite.annotate({description: 'Maximum number of entries'})),
		path: Schema.optional(Schema.String.annotate({description: 'Directory to list'}))
	}),
	success: Schema.String
})

export const Skill = Tool.providerDefined({
	args: Schema.Void,
	customName: 'skill',
	failure: Schema.Defect(),
	id: 'pi.skill',
	parameters: Schema.Struct({name: Schema.String}),
	providerName: 'skill',
	success: Schema.String
})(undefined)

export const Subagent = Tool.providerDefined({
	args: Schema.Void,
	customName: 'subagent',
	failure: Schema.Defect(),
	id: 'pi.subagent',
	parameters: Schema.Struct({agent: Schema.String, prompt: Schema.String}),
	providerName: 'subagent',
	success: Schema.String
})(undefined)

export const PiToolkit = Toolkit.make(Read, Write, Edit, Bash, Grep, Find, Ls, Skill, Subagent)
