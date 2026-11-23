import {Boolean, Function, Option, Schema} from 'effect'

import {HStack, Image, Spacer, Text, VStack} from '@expo/ui/swift-ui'
import {
	contentShape,
	font,
	foregroundStyle,
	fixedSize,
	frame,
	imageScale,
	layoutPriority,
	lineLimit,
	minimumScaleFactor,
	monospacedDigit,
	opacity,
	shapes,
	strikethrough
} from '@expo/ui/swift-ui/modifiers'

import {StatusDot} from '@deslop/components-mobile/blocks/status-dot'
import type {ProblemStatus} from '@deslop/components-mobile/blocks/status-dot'
import {colors, space, text} from '@deslop/components-mobile/theme'

import type {Hero} from '#lib/day.ts'
import {tones} from '#lib/status.ts'

const DOTS = {bad: 'error', warn: 'warning'} satisfies Record<RowProblem, ProblemStatus>

const STRUCK = [foregroundStyle(colors.mutedForeground), strikethrough({isActive: true, pattern: 'solid'})]

// Only a problem is coloured, and has a dot.
export type RowProblem = typeof RowProblem.Type
const RowProblem = Schema.Literals(['bad', 'warn'])

// A flight on Home reads large and light; the times of one flight read at body size; a quiet row's value is a remark, such as what a change was booked as.
export type RowSize = typeof RowSize.Type
const RowSize = Schema.Literals(['big', 'plain', 'quiet'])

const ROW_SIZES = {
	big: {
		label: font({textStyle: 'title3', weight: 'semibold'}),
		value: [font({textStyle: 'title', weight: 'light'}), foregroundStyle(colors.foreground)]
	},
	plain: {label: font({textStyle: 'body'}), value: [font({textStyle: 'title3'}), foregroundStyle(colors.foreground)]},
	quiet: {label: font({textStyle: 'body'}), value: [font({textStyle: 'body'}), foregroundStyle(colors.mutedForeground)]}
} satisfies Record<RowSize, unknown>

// The next step folded and as a book's page, and at a glance above a laptop's fold.
export type HeroSize = typeof HeroSize.Type
const HeroSize = Schema.Literals(['glance', 'read'])

const HERO_SIZES = {
	glance: {label: font({textStyle: 'title2'}), value: text.display, was: font({textStyle: 'title', weight: 'medium'})},
	read: {label: font({textStyle: 'body'}), value: text.display, was: font({textStyle: 'title3', weight: 'medium'})}
} satisfies Record<HeroSize, unknown>

function labelColor(problem: Option.Option<RowProblem>) {
	return Option.match(problem, {onNone: () => colors.foreground, onSome: tone => tones[tone]})
}

function Dot(props: {problem: Option.Option<RowProblem>}) {
	return Option.match(props.problem, {
		onNone: Function.constNull,
		onSome: problem => <StatusDot status={DOTS[problem]} />
	})
}

// A row of the day: what it is with a quieter line under it, and its time on the right with the old time struck through beside it.
export function TimeRow(props: {
	chevron: boolean
	label: string
	problem: Option.Option<RowProblem>
	size: RowSize
	sub: Option.Option<string>
	value: Option.Option<string>
	was: Option.Option<string>
}) {
	return (
		<HStack
			spacing={space[3]}
			modifiers={[frame({alignment: 'leading', maxWidth: Infinity}), contentShape(shapes.rectangle())]}
		>
			<VStack alignment="leading" spacing={0} modifiers={[layoutPriority(1)]}>
				<HStack spacing={space[2]}>
					<Dot problem={props.problem} />
					<Text modifiers={[ROW_SIZES[props.size].label, foregroundStyle(labelColor(props.problem)), lineLimit(1)]}>
						{props.label}
					</Text>
				</HStack>
				{Option.match(props.sub, {
					onNone: Function.constNull,
					onSome: sub => (
						<Text modifiers={[font({textStyle: 'subheadline'}), foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
							{sub}
						</Text>
					)
				})}
			</VStack>
			<Spacer />
			<HStack
				alignment="firstTextBaseline"
				spacing={space[2]}
				modifiers={[fixedSize({horizontal: true, vertical: false})]}
			>
				{Option.match(props.was, {
					onNone: Function.constNull,
					onSome: was => <Text modifiers={[font({textStyle: 'subheadline'}), monospacedDigit(), ...STRUCK]}>{was}</Text>
				})}
				{Option.match(props.value, {
					onNone: Function.constNull,
					onSome: value => <Text modifiers={[...ROW_SIZES[props.size].value, monospacedDigit()]}>{value}</Text>
				})}
			</HStack>
			{props.chevron && (
				<Image
					systemName="chevron.right"
					modifiers={[imageScale('small'), foregroundStyle(colors.mutedForeground), opacity(0.55)]}
				/>
			)}
		</HStack>
	)
}

// The next step large: what to do over its time or gate, with how long is left beside it.
export function HeroView(props: {hero: Hero; size: HeroSize}) {
	return (
		<VStack alignment="leading" spacing={0} modifiers={[frame({alignment: 'leading', maxWidth: Infinity})]}>
			<Text modifiers={[HERO_SIZES[props.size].label, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
				{props.hero.label}
			</Text>
			<HStack alignment="lastTextBaseline" spacing={space[3]}>
				<HStack spacing={space[3]}>
					<Dot problem={props.hero.problem} />
					<HStack alignment="firstTextBaseline" spacing={space[3]}>
						<Text
							modifiers={[
								HERO_SIZES[props.size].value,
								monospacedDigit(),
								foregroundStyle(labelColor(props.hero.problem)),
								// A placeholder, such as a gate not yet posted, is faint.
								opacity(
									Boolean.match(props.hero.pending, {onFalse: Function.constant(1), onTrue: Function.constant(0.35)})
								),
								lineLimit(1),
								minimumScaleFactor(0.5)
							]}
						>
							{props.hero.value}
						</Text>
						{Option.match(props.hero.was, {
							onNone: Function.constNull,
							onSome: was => <Text modifiers={[HERO_SIZES[props.size].was, monospacedDigit(), ...STRUCK]}>{was}</Text>
						})}
					</HStack>
				</HStack>
				<Spacer />
				<Text modifiers={[HERO_SIZES[props.size].label, foregroundStyle(colors.mutedForeground), lineLimit(1)]}>
					{props.hero.right}
				</Text>
			</HStack>
		</VStack>
	)
}
