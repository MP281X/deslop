import {assert, it} from '@effect/vitest'

import {Option} from 'effect'

import {pageText} from './article.ts'

const HTML = `<html><head>
<title>Fallback title</title>
<meta property="og:title" content="Soup &amp; bread">
<meta property="og:site_name" content="Kitchen">
<meta name="description" content="Two recipes.">
<link rel="icon" type="image/png" sizes="32x32" href="/small.png">
<link rel="icon" type="image/png" sizes="192x192" href="/large.png">
</head><body>
<nav>Menu</nav>
<main><h1>Soup</h1><p>Simmer the <a href="/lentils">lentils</a>.</p><ul><li>Salt</li></ul></main>
<script>track()</script>
</body></html>`

it('reads a page as Markdown with its links, without its menus and scripts, and picks its largest icon', () => {
	const extraction = pageText(HTML, new URL('https://example.com/soup'))
	assert.strictEqual(extraction.title, 'Soup & bread')
	assert.deepStrictEqual(extraction.author, Option.some('Kitchen'))
	assert.deepStrictEqual(extraction.image, Option.some('https://example.com/large.png'))
	assert.strictEqual(
		extraction.text,
		'Two recipes.\n\n# Soup\n\nSimmer the [lentils](https://example.com/lentils).\n\n- Salt'
	)
})
