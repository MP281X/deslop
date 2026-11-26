import {Boolean, Function, Option, pipe} from 'effect'

import {HStack, Text} from '@expo/ui/swift-ui'
import {fixedSize, foregroundStyle, lineLimit, monospacedDigit, strikethrough} from '@expo/ui/swift-ui/modifiers'
import type {ReactNode} from 'react'

import {StatusDot} from '#components/blocks/status-dot.tsx'
import type {ProblemStatus} from '#components/blocks/status-dot.tsx'
import {colors, space, text} from '#components/theme.ts'
import {ItemContent} from '#components/ui/item.tsx'

// What is wrong with a row: its dot before the title, and its reason in place of the muted line.
export type RowProblem = {reason: string; status: ProblemStatus}

// The row every list app shares, inside an `Item` of size `xs`: an optional small cover, a title on one line, one muted line, and the numbers or the time at the trailing edge, with a time it moved from struck through before it. `muted` makes the title recede, as a read chapter or a note waiting to be removed.
export function Row(props: {
	cover?: ReactNode
	line: Option.Option<string>
	muted?: boolean
	problem: Option.Option<RowProblem>
	title: string
	trailing: Option.Option<string>
	was?: Option.Option<string>
}) {
	const line = pipe(
		props.problem,
		Option.map(problem => problem.reason),
		Option.orElse(() => props.line)
	)
	return (
		<>
			{props.cover}
			<ItemContent>
				<HStack spacing={space[2]}>
					{Option.match(props.problem, {
						onNone: Function.constNull,
						onSome: problem => <StatusDot status={problem.status} />
					})}
					<Text
						modifiers={[
							text.row,
							foregroundStyle(
								Boolean.match(props.muted === true, {
									onFalse: () => colors.foreground,
									onTrue: () => colors.mutedForeground
								})
							),
							lineLimit(1)
						]}
					>
						{props.title}
					</Text>
				</HStack>
				{Option.match(line, {
					onNone: Function.constNull,
					onSome: found => (
						<Text modifiers={[text.detail, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>{found}</Text>
					)
				})}
			</ItemContent>
			<HStack
				alignment="firstTextBaseline"
				spacing={space[1]}
				modifiers={[fixedSize({horizontal: true, vertical: false})]}
			>
				{Option.match(props.was ?? Option.none(), {
					onNone: Function.constNull,
					onSome: was => (
						<Text
							modifiers={[
								text.detail,
								monospacedDigit(),
								foregroundStyle(colors.mutedForeground),
								strikethrough({isActive: true, pattern: 'solid'})
							]}
						>
							{was}
						</Text>
					)
				})}
				{Option.match(props.trailing, {
					onNone: Function.constNull,
					onSome: trailing => (
						<Text modifiers={[text.detail, monospacedDigit(), foregroundStyle(colors.mutedForeground)]}>
							{trailing}
						</Text>
					)
				})}
			</HStack>
		</>
	)
}
