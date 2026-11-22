import {String, pipe} from 'effect'

// A note's Markdown opens only web links, as the page reader keeps only http(s) anchors; a link to any other scheme, such as a phone number or an app, shows only its text.
export function webLinksOnly(line: string) {
	return pipe(
		line,
		String.replaceAll(/\[([^\]]*)\]\((?!https?:\/\/)[^)]*\)/giu, '$1'),
		String.replaceAll(/<(?!https?:\/\/)([a-z][\d+.a-z-]*:[^\s>]*)>/giu, '$1')
	)
}
