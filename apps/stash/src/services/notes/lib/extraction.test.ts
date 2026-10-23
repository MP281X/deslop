import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {pageText} from './extraction.ts'

it('keeps an article as Markdown with its headings, lists and absolute links, without the page chrome', () => {
	const page = pageText(
		`<html><head><title>Pingora</title><meta property="og:image" content="/cover.png"></head><body>
			<nav>Home Blog Careers</nav>
			<article>
				<h1>How we built Pingora</h1>
				<p>Pingora is a proxy written in <a href="https://www.rust-lang.org/">Rust</a> that serves over 1 trillion requests a day.</p>
				<h2>Why</h2>
				<ul><li>NGINX workers do not share connection pools.</li><li>See <a href="/blog/tokio">our Tokio post</a>.<ol><li>Install Rust</li><li>Add the crate</li></ol></li></ul>
				<pre>fn main() {
    serve();
}</pre>
			</article>
			<footer>© Cloudflare</footer>
		</body></html>`,
		new URL('https://blog.cloudflare.com/pingora/')
	)
	assert.strictEqual(
		page.text,
		`# How we built Pingora

Pingora is a proxy written in [Rust](https://www.rust-lang.org/) that serves over 1 trillion requests a day.

## Why

- NGINX workers do not share connection pools.
- See [our Tokio post](https://blog.cloudflare.com/blog/tokio).
  1. Install Rust
  2. Add the crate

\`\`\`
fn main() {
    serve();
}
\`\`\``
	)
	assert.deepStrictEqual(page.image, Option.some('https://blog.cloudflare.com/cover.png'))
	assert.strictEqual(page.title, 'Pingora')
})

it('shows a page without a preview by its largest PNG icon, else by the favicon service', () => {
	const icon = pageText(
		`<html><head><title>Docs</title>
			<link rel="icon" href="/favicon.ico">
			<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
			<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
		</head><body><p>Docs</p></body></html>`,
		new URL('https://docs.example.com/guide')
	)
	assert.deepStrictEqual(icon.image, Option.some('https://docs.example.com/touch.png'))
	assert.deepStrictEqual(
		pageText('<html><body><p>Docs</p></body></html>', new URL('https://docs.example.com/guide')).image,
		Option.some('https://www.google.com/s2/favicons?domain=docs.example.com&sz=128')
	)
})
