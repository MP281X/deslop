import {Array, Boolean, Match, Number, Option, Order, Predicate, Result, String, pipe} from 'effect'

import * as cheerio from 'cheerio'
import type {AnyNode} from 'domhandler'

import {captureUrl, plainText} from '#services/notes/lib/utils.ts'
import {Extraction} from '#services/notes/schema.ts'

const BLOCK_TAGS = [
	'article',
	'aside',
	'blockquote',
	'dd',
	'details',
	'div',
	'dl',
	'dt',
	'figure',
	'main',
	'p',
	'section',
	'table'
]

const BY_SIZE = Order.mapInput(Order.flip(Order.Number), (icon: {href: string; size: number}) => icon.size)

function element($: cheerio.CheerioAPI, input: {base: URL; inner: string; node: AnyNode; tag: string}) {
	const text = String.trim(input.inner)
	return pipe(
		Match.value(input.tag),
		Match.when('li', () => {
			const marker = Boolean.match($(input.node).parent().is('ol'), {
				onFalse: () => '-',
				onTrue: () => `${$(input.node).index() + 1}.`
			})
			return `\n${String.repeat($(input.node).parents('ul, ol').length - 1)('  ')}${marker} ${text}`
		}),
		Match.when('pre', () => `\n\n\`\`\`\n${$(input.node).text()}\n\`\`\`\n\n`),
		Match.when('code', () => `\`${text}\``),
		Match.when('br', () => '\n'),
		Match.when('tr', () => `\n${text}`),
		Match.when(
			name => name === 'td' || name === 'th',
			() => `${text} | `
		),
		Match.when('a', () =>
			pipe(
				Option.fromNullishOr($(input.node).attr('href')),
				Option.flatMap(Option.liftThrowable(href => new URL(href, input.base))),
				Option.filter(link => (link.protocol === 'https:' || link.protocol === 'http:') && String.isNonEmpty(text)),
				Option.match({onNone: () => input.inner, onSome: link => `[${text}](${link.href})`})
			)
		),
		Match.when(
			name => Array.contains(BLOCK_TAGS, name),
			() => `\n\n${text}\n\n`
		),
		Match.orElse(() => input.inner)
	)
}

function markdown($: cheerio.CheerioAPI, node: AnyNode, base: URL): string {
	if (node.nodeType === 3) return String.replaceAll(/\s+/gu, ' ')(node.data)
	if (!Predicate.hasProperty(node, 'tagName')) return ''
	const inner = pipe(
		$(node).contents().toArray(),
		Array.map(child => markdown($, child, base)),
		Array.join('')
	)
	return pipe(
		Array.findFirstIndex(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], heading => heading === node.tagName),
		Option.map(index => `\n\n${String.repeat(index + 1)('#')} ${String.trim(inner)}\n\n`),
		Option.getOrElse(() => element($, {base, inner, node, tag: node.tagName}))
	)
}

// The article's text as Markdown, so the AI keeps its headings, lists and link targets.
export function pageText(html: string, url: URL) {
	const $ = cheerio.load(html)
	$('script, style, noscript, iframe, svg, nav, header, footer, form, aside, button, dialog, template').remove()
	const description =
		$('meta[property="og:description"]').attr('content') ?? $('meta[name="description"]').attr('content')
	const root = pipe(
		['article', 'main', '[role="main"]'],
		Array.map(selector => $(selector).first()),
		Array.findFirst(found => String.length(plainText(found.text())) >= 200),
		Option.getOrElse(() => $('body'))
	)
	// Whitespace stays only inside code blocks; elsewhere it is markup indentation.
	const body = pipe(
		Array.join(
			Array.map(root.toArray(), node => markdown($, node, url)),
			''
		),
		String.split('```'),
		Array.map((part, index) =>
			Boolean.match(index % 2 === 1, {
				onFalse: () =>
					pipe(
						part,
						String.split('\n'),
						Array.map(line => String.replace(/^ (?=\S)/u, '')(String.trimEnd(line))),
						Array.join('\n'),
						String.replaceAll(/\n{3,}/gu, '\n\n')
					),
				onTrue: () => part
			})
		),
		Array.join('```'),
		String.trim
	)
	return Extraction.make({
		author: pipe(
			Option.fromUndefinedOr($('meta[property="og:site_name"]').attr('content')),
			Option.map(plainText),
			Option.filter(String.isNonEmpty),
			Option.orElseSome(() => url.hostname)
		),
		// Without a preview, the site's largest PNG or touch icon (ICO and SVG do not decode), else the favicon service.
		image: pipe(
			Option.fromNullishOr(
				$('meta[property="og:image"]').attr('content') ?? $('meta[name="twitter:image"]').attr('content')
			),
			Option.orElse(() =>
				pipe(
					$('link[rel~="apple-touch-icon"], link[rel~="icon"]').toArray(),
					Array.map(link => $(link)),
					Array.filter(
						link =>
							link.attr('type') === 'image/png' ||
							Option.isSome(String.match(/\.png(?:$|\?)/iu)(link.attr('href') ?? '')) ||
							Option.isSome(String.match(/apple-touch-icon/iu)(link.attr('rel') ?? ''))
					),
					Array.filterMap(link =>
						Result.fromOption(
							Option.map(Option.fromUndefinedOr(link.attr('href')), href => ({
								href,
								size: pipe(
									String.match(/(\d+)x\d+/u)(link.attr('sizes') ?? ''),
									Option.flatMap(match => Array.get(match, 1)),
									Option.flatMap(Number.parse),
									Option.getOrElse(() => 0)
								)
							})),
							() => undefined
						)
					),
					Array.sort(BY_SIZE),
					Array.head,
					Option.map(icon => icon.href)
				)
			),
			Option.flatMap(Option.liftThrowable(image => new URL(image, url).href)),
			Option.orElseSome(() => `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=128`)
		),
		text: pipe(
			[
				pipe(
					[
						Option.map(
							Option.fromUndefinedOr($('meta[property="article:published_time"]').attr('content')),
							date => `Published ${date}`
						),
						Option.map(
							Option.fromUndefinedOr(
								$('meta[name="author"]').attr('content') ?? $('meta[property="article:author"]').attr('content')
							),
							name => `by ${plainText(name)}`
						)
					],
					Array.getSomes,
					Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
					Option.map(Array.join(' '))
				),
				Option.map(Option.fromUndefinedOr(description), plainText),
				Option.some(body)
			],
			Array.getSomes,
			Array.filter(String.isNonEmpty),
			Array.join('\n\n')
		),
		title: plainText($('meta[property="og:title"]').attr('content') ?? $('title').first().text()),
		url: captureUrl(url.href) ?? url.href
	})
}
