// @effect-diagnostics globalDate:off -- The widget runtime serializes only the layout's body, which cannot import Effect; SwiftUI's timers take a Date.
import {HStack, Image, ProgressView, Spacer, Text, VStack} from '@expo/ui/swift-ui'
import {
	background,
	font,
	foregroundStyle,
	frame,
	lineLimit,
	monospacedDigit,
	padding,
	tint
} from '@expo/ui/swift-ui/modifiers'
import {createLiveActivity} from 'expo-widgets'

import {ACTIVITY_NAME} from '#services/bookings/lib/utils.ts'
import type {ActivityProps} from '#services/bookings/schema.ts'

// The widget runtime runs only this body, so the palette and helpers live inside it; the server words every line, and the layout only places them.
function JourneyLayout(props: ActivityProps) {
	'widget'
	const palette = {bad: '#ff453a', good: '#30d158', info: '#0a84ff', plain: '#ffffff', warn: '#ffd60a'}
	const gray = '#8e8e93'

	// The gate, belt or platform on its colour, the island's one value read at a glance.
	function chip(size: number) {
		if (props.chip === undefined) return undefined
		return (
			<Text
				modifiers={[
					font({size, weight: 'bold'}),
					monospacedDigit(),
					foregroundStyle('#000000'),
					padding({horizontal: 7, vertical: 2}),
					background(palette[props.chip.tone], {shape: 'capsule'})
				]}
			>
				{props.chip.text}
			</Text>
		)
	}

	function lead(size: number) {
		if (props.chip === undefined) return <Image systemName={props.symbol} color={palette[props.tone]} size={size} />
		return chip(size)
	}

	function countdown(size: number) {
		if (props.countdown === undefined) {
			return (
				<Text modifiers={[font({size, weight: 'semibold'}), foregroundStyle(palette[props.tone]), lineLimit(1)]}>
					{props.label}
				</Text>
			)
		}
		return (
			<Text
				timerInterval={{lower: new Date(), upper: new Date(props.countdown)}}
				countsDown
				modifiers={[
					font({size, weight: 'semibold'}),
					monospacedDigit(),
					foregroundStyle(palette[props.tone]),
					lineLimit(1)
				]}
			/>
		)
	}

	function endpoint(input: {
		alignment: 'leading' | 'trailing'
		code: string
		note: string
		time: string
		tone: ActivityProps['tone']
	}) {
		return (
			<VStack alignment={input.alignment} spacing={1}>
				<Text
					modifiers={[
						font({size: {flight: 22, train: 15}[props.kind], weight: 'bold'}),
						foregroundStyle(palette.plain),
						lineLimit(1)
					]}
				>
					{input.code}
				</Text>
				{/* The ticket's time in the station's or airport's zone, not the iPhone's. */}
				<Text
					modifiers={[font({size: 15, weight: 'semibold'}), monospacedDigit(), foregroundStyle(palette[input.tone])]}
				>
					{input.time}
				</Text>
				{input.note !== '' && (
					<Text modifiers={[font({size: 11}), foregroundStyle(gray), lineLimit(1)]}>{input.note}</Text>
				)}
			</VStack>
		)
	}

	function departure() {
		return endpoint({
			alignment: 'leading',
			code: props.from,
			note: props.departureNote,
			time: props.departureTime,
			tone: props.departureTone
		})
	}

	function arrival() {
		return endpoint({
			alignment: 'trailing',
			code: props.to,
			note: props.arrivalNote,
			time: props.arrivalTime,
			tone: props.arrivalTone
		})
	}

	function status() {
		return (
			<VStack spacing={8} modifiers={[padding({top: 4})]}>
				{props.progressFrom !== undefined && (
					<ProgressView
						timerInterval={{lower: new Date(props.progressFrom), upper: new Date(props.arrives)}}
						countsDown={false}
						modifiers={[tint(palette.info)]}
					/>
				)}
				<HStack spacing={8}>
					<VStack alignment="leading" spacing={2}>
						<HStack spacing={6}>
							<Text modifiers={[font({size: 17, weight: 'bold'}), foregroundStyle(palette[props.tone]), lineLimit(1)]}>
								{props.headline}
							</Text>
							{props.countdown !== undefined && countdown(17)}
						</HStack>
						{props.detail !== '' && (
							<Text modifiers={[font({size: 12}), foregroundStyle(gray), lineLimit(1)]}>{props.detail}</Text>
						)}
					</VStack>
					<Spacer />
					{chip(16)}
				</HStack>
			</VStack>
		)
	}

	return {
		banner: (
			<VStack spacing={10} modifiers={[padding({all: 16}), foregroundStyle(palette.plain)]}>
				<HStack>
					<Text modifiers={[font({size: 12, weight: 'semibold'}), foregroundStyle(gray)]}>{props.title}</Text>
					<Spacer />
					<Text modifiers={[font({size: 12}), foregroundStyle(gray)]}>{props.note}</Text>
				</HStack>
				<HStack alignment="bottom">
					{departure()}
					<Spacer />
					<Image systemName={({flight: 'airplane', train: 'tram.fill'} as const)[props.kind]} color={gray} size={16} />
					<Spacer />
					{arrival()}
				</HStack>
				{status()}
			</VStack>
		),
		compactLeading: lead(13),
		compactTrailing: countdown(14),
		expandedBottom: status(),
		expandedCenter: (
			<Text
				modifiers={[
					font({size: 12, weight: 'semibold'}),
					foregroundStyle(gray),
					lineLimit(1),
					frame({alignment: 'center', maxWidth: 400})
				]}
			>
				{props.title}
			</Text>
		),
		expandedLeading: <VStack modifiers={[padding({leading: 6})]}>{departure()}</VStack>,
		expandedTrailing: <VStack modifiers={[padding({trailing: 6})]}>{arrival()}</VStack>,
		minimal: <Image systemName={props.symbol} color={palette[props.tone]} size={13} />
	}
}

export const JourneyActivity = createLiveActivity<ActivityProps>(ACTIVITY_NAME, JourneyLayout)
