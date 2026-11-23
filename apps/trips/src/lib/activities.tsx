/* oxlint-disable effecttsgo/global-date -- The widget runtime serializes only the layout's body, which cannot import Effect; SwiftUI's timers take a Date. */
import {HStack, Image, ProgressView, Spacer, Text, VStack} from '@expo/ui/swift-ui'
import {
	font,
	foregroundStyle,
	frame,
	lineLimit,
	minimumScaleFactor,
	monospacedDigit,
	opacity,
	padding,
	progressViewStyle,
	strikethrough,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {createLiveActivity} from 'expo-widgets'

import {ACTIVITY_NAME} from '#services/flights/lib/utils.ts'
import type {ActivityProps} from '#services/flights/schema.ts'

// The widget runtime runs only this body, so the palette and helpers live inside it; the server words every line, and the layout only places them. Two fields never move: what to do on the left, the time left on the right; under them the day's bar and one line of small print.
function DayLayout(props: typeof ActivityProps.Encoded) {
	'widget'
	const tones = {bad: '#ff6467', good: '#fafafa', info: '#fafafa', plain: '#fafafa', warn: '#ff9e3b'}
	const gray = '#9f9fa9'
	const plain = '#fafafa'

	function struck(size: number, text?: string) {
		if (text === undefined) return undefined
		return (
			<Text
				modifiers={[
					font({size, weight: 'medium'}),
					monospacedDigit(),
					foregroundStyle(gray),
					strikethrough({isActive: true, pattern: 'solid'})
				]}
			>
				{text}
			</Text>
		)
	}

	// A placeholder, such as a gate not yet posted, is faint.
	function faint() {
		if (props.pending) return 0.35
		return 1
	}

	function what(size: number) {
		return (
			<VStack alignment="leading" spacing={1}>
				<Text modifiers={[font({size: 13, weight: 'semibold'}), foregroundStyle(gray), lineLimit(1)]}>
					{props.label}
				</Text>
				<HStack alignment="firstTextBaseline" spacing={8}>
					<Text
						modifiers={[
							font({size, weight: 'bold'}),
							monospacedDigit(),
							foregroundStyle(plain),
							opacity(faint()),
							lineLimit(1),
							minimumScaleFactor(0.6)
						]}
					>
						{props.value}
					</Text>
					{struck(size / 2, props.was)}
				</HStack>
			</VStack>
		)
	}

	function left(size: number) {
		if (props.deadline === undefined) {
			return (
				<Text modifiers={[font({size, weight: 'medium'}), monospacedDigit(), foregroundStyle(plain), lineLimit(1)]}>
					{props.untilValue}
				</Text>
			)
		}
		return (
			<Text
				timerInterval={{lower: new Date(), upper: new Date(props.deadline)}}
				countsDown
				modifiers={[
					font({size, weight: 'medium'}),
					monospacedDigit(),
					foregroundStyle(plain),
					lineLimit(1),
					frame({alignment: 'trailing', maxWidth: 150})
				]}
			/>
		)
	}

	function when(size: number) {
		return (
			<VStack alignment="trailing" spacing={1}>
				<Text modifiers={[font({size: 13, weight: 'semibold'}), foregroundStyle(gray), lineLimit(1)]}>
					{props.until}
				</Text>
				{left(size)}
			</VStack>
		)
	}

	// Done parts full, the current part filling as its time passes, the parts ahead empty.
	function part(index: number) {
		if (index === props.segment) {
			return (
				<ProgressView
					timerInterval={{lower: new Date(props.segmentSince), upper: new Date(props.segmentUntil)}}
					countsDown={false}
					modifiers={[tint(plain), frame({maxWidth: Infinity})]}
				/>
			)
		}
		if (index < props.segment) return <ProgressView value={1} modifiers={[tint(plain), frame({maxWidth: Infinity})]} />
		return <ProgressView value={0} modifiers={[tint(plain), frame({maxWidth: Infinity})]} />
	}

	function bar() {
		return (
			<HStack spacing={4}>
				{part(0)}
				{part(1)}
				{part(2)}
				{part(3)}
			</HStack>
		)
	}

	function noteColor() {
		if (props.noteTone === 'warn') return tones.warn
		return gray
	}

	function print() {
		return (
			<VStack alignment="leading" spacing={5}>
				<HStack spacing={10}>
					<Text modifiers={[font({size: 13, weight: 'medium'}), foregroundStyle(gray), lineLimit(1)]}>
						{props.small}
					</Text>
					<Spacer />
					<HStack spacing={6}>
						<Text
							modifiers={[
								font({size: 13, weight: 'medium'}),
								monospacedDigit(),
								foregroundStyle(noteColor()),
								lineLimit(1)
							]}
						>
							{props.note}
						</Text>
						{struck(13, props.noteWas)}
					</HStack>
				</HStack>
				{props.problem !== undefined && (
					<HStack spacing={7}>
						<Image systemName="circle.fill" color={tones[props.tone]} size={8} />
						<Text modifiers={[font({size: 13, weight: 'semibold'}), foregroundStyle(tones[props.tone]), lineLimit(1)]}>
							{props.problem}
						</Text>
					</HStack>
				)}
			</VStack>
		)
	}

	// The ring drains to the next deadline, in the warning colour while the small print names a problem; with nothing left to wait for it stays full.
	function ring() {
		if (props.deadline === undefined) {
			return (
				<ProgressView
					value={1}
					modifiers={[progressViewStyle('circular'), tint(tones[props.tone]), frame({height: 22, width: 22})]}
				/>
			)
		}
		return (
			<ProgressView
				timerInterval={{lower: new Date(props.since), upper: new Date(props.deadline)}}
				countsDown
				modifiers={[progressViewStyle('circular'), tint(tones[props.tone]), frame({height: 22, width: 22})]}
			/>
		)
	}

	// The gate where there is one, else a symbol for where he is: both slots are always filled.
	function where() {
		if (props.gate === undefined) return <Image systemName={props.symbol} color={plain} size={15} />
		return (
			<Text
				modifiers={[font({size: 14, weight: 'bold'}), foregroundStyle(plain), lineLimit(1), minimumScaleFactor(0.6)]}
			>
				{props.gate}
			</Text>
		)
	}

	return {
		banner: (
			<VStack alignment="leading" spacing={11} modifiers={[padding({all: 16})]}>
				<HStack alignment="bottom" spacing={12}>
					{what(34)}
					<Spacer />
					{when(34)}
				</HStack>
				{bar()}
				{print()}
			</VStack>
		),
		compactLeading: where(),
		compactTrailing: ring(),
		expandedBottom: (
			<VStack alignment="leading" spacing={10} modifiers={[padding({horizontal: 6, top: 4})]}>
				{bar()}
				{print()}
			</VStack>
		),
		expandedLeading: <VStack modifiers={[padding({leading: 6})]}>{what(30)}</VStack>,
		expandedTrailing: <VStack modifiers={[padding({trailing: 6})]}>{when(30)}</VStack>,
		minimal: ring()
	}
}

// Registered at every launch: the activity the server starts by push names this layout, and the app starts none itself.
createLiveActivity<typeof ActivityProps.Encoded>(ACTIVITY_NAME, DayLayout)
