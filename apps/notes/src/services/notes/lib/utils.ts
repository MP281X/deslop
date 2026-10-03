import {Array, Option, String, pipe} from 'effect'

const xHosts = ['twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'x.com', 'www.x.com', 'mobile.x.com']

const tracking = [
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'utm_id',
	'gclid',
	'dclid',
	'fbclid',
	'msclkid',
	'igshid',
	'twclid'
]

export function captureUrl(text: string) {
	const match = pipe(String.match(/https?:\/\/[^\s<>]+/iu)(text), Option.getOrUndefined)
	// oxlint-disable-next-line unicorn/no-null -- The shared Note contract represents a missing URL as null.
	if (match === undefined) return null
	return pipe(
		Array.head(match),
		Option.map(value => {
			const url = new URL(value)
			if (Array.contains(xHosts, url.hostname)) {
				url.hostname = 'x.com'
				url.protocol = 'https:'
				url.searchParams.delete('ref_src')
				url.searchParams.delete('ref_url')
			}
			for (const key of tracking) url.searchParams.delete(key)
			// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- URLSearchParams canonicalizes query order without decoding or dropping article parameters.
			url.searchParams.sort()
			return url.href
		}),
		Option.getOrNull
	)
}

export function sourceFor(url: string | null) {
	if (url === null) return 'Note' as const
	const host = new URL(url).hostname
	if (Array.contains(xHosts, host) || host === 't.co') return 'X' as const
	if (host === 'tiktok.com' || String.endsWith('.tiktok.com')(host)) return 'TikTok' as const
	return 'Website' as const
}

export function pastedContent(raw: string) {
	return pipe(raw, String.replace(/https?:\/\/[^\s<>]+/giu, ''), String.trim)
}

export function plainText(text: string) {
	return pipe(text, String.replace(/\s+/gu, ' '), String.trim)
}
