import {assert, describe, it} from '@effect/vitest'

import {Option} from 'effect'

import {captionTranscript, clock, speechOnly} from '#services/media/lib/utils.ts'

describe('captionTranscript', () => {
	it('reads cue settings, markup and escapes', () => {
		assert.strictEqual(
			captionTranscript({
				authored: false,
				vtt: 'WEBVTT\n\n1\n00:00:10.000 --> 00:00:12.000 align:start\n<c>Tom &amp; Jerry</c> &lt;3'
			}),
			'[00:10] Tom & Jerry <3\n'
		)
	})

	it('drops a rolling repeat that starts as the previous cue ends', () => {
		assert.strictEqual(
			captionTranscript({
				authored: false,
				vtt: 'WEBVTT\n\n00:00:00.160 --> 00:00:02.869\nhi everyone\n\n00:00:02.869 --> 00:00:02.879\nhi everyone\n\n00:00:02.879 --> 00:00:05.990\nwelcome to'
			}),
			'[00:00] hi everyone\n[00:02] welcome to\n'
		)
	})

	it('keeps every line of a multiline cue and drops only the rolled-over line', () => {
		assert.strictEqual(
			captionTranscript({
				authored: false,
				vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nfirst line\nsecond line\n\n00:00:03.000 --> 00:00:05.000\nsecond line\nthird line'
			}),
			'[00:01] first line\n[00:01] second line\n[00:03] third line\n'
		)
	})

	it('keeps repeats that are separated in time or authored', () => {
		assert.strictEqual(
			captionTranscript({
				authored: false,
				vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nYes.\n\n00:00:10.000 --> 00:00:11.000\nYes.'
			}),
			'[00:01] Yes.\n[00:10] Yes.\n'
		)
		assert.strictEqual(
			captionTranscript({
				authored: true,
				vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nYes.\n\n00:00:02.000 --> 00:00:03.000\nYes.'
			}),
			'[00:01] Yes.\n[00:02] Yes.\n'
		)
	})
})

describe('clock', () => {
	it('counts minutes past an hour and a day', () => {
		assert.strictEqual(clock(3725), '62:05')
		assert.strictEqual(clock(90061), '1501:01')
	})
})

describe('speechOnly', () => {
	it('keeps a spoken transcript', () => {
		const speech =
			"[00:00] This app fixes MacBook.\n[00:02] It fixes so many annoying Mac limitations in one app.\n[00:06] Want to fully quit an app?\n[00:08] Normally you need Command-Q,\n[00:10] but with quit on close, just hit the X\n[00:12] and it's completely closed.\n"
		assert.deepStrictEqual(speechOnly(speech), Option.some(speech))
	})

	it('drops what Whisper heard in a song: loops, repeats and a few invented phrases', () => {
		assert.deepStrictEqual(
			speechOnly(
				"[00:00] Thank you for watching! I'm gonna check out the blue one\n[00:26] I'm gonna check out the blue one\n[00:32] I'm sorry Ooh, ooh, ooh, ooh, ooh, ooh\n[01:05] Ooh, ooh, ooh, ooh, ooh, ooh\n[01:10] Do-do-do-do-do-do-do-do-do-da-da\n[01:14] Da-da-da-da-da-da-da-da-da\n[01:18] Ooh, ooh, ooh, ooh, ooh, ooh, ooh, ooh\n[01:23] Da-da-da-da-da-da-da-da I'm gonna go get some water Mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm, mmm I'm going to go a little bit more of a fan of this one. I'm gonna go get some water I'm gonna go get some water I'm gonna go get some water\n[02:26] I'm gonna go get some water\n[02:28] I'm gonna go get some water\n[02:30] I'm gonna go get some water\n[02:32] I'm gonna go get some water\n"
			),
			Option.none()
		)
	})
})
