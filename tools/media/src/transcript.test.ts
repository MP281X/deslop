import {assert, describe, it} from '@effect/vitest'

import {captionTranscript, clock} from '#transcript'

describe('captionTranscript', () => {
	it('reads CRLF files, tab-separated timings, cue settings, markup and escapes', () => {
		assert.strictEqual(
			captionTranscript({
				authored: false,
				vtt: 'WEBVTT\r\n\r\n1\r\n00:00:10.000\t-->\t00:00:12.000 align:start\r\n<c>Tom &amp; Jerry</c>\r\n\r\n00:00:12.000 --> 00:00:13.000\r\nTom &amp; Jerry\r\n\r\n00:00:14.000 --> 00:00:15.000\r\n&lt;3\r\n'
			}),
			'[00:10] Tom & Jerry\n[00:14] <3\n'
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
