// Pass this file's text to preview_evaluate on every html_render page; it returns the editorial budget.
;(() => {
	function normalized(value) {
		return (value || '').trim().replaceAll(/\s+/gu, ' ')
	}
	function count(value) {
		const text = normalized(value)
		if (text === '') return 0
		return text.split(' ').length
	}
	const text = normalized(document.body.innerText)
	const paragraphs = [...document.querySelectorAll('p')]
		.filter(element => element.offsetParent !== null)
		.map(element => {
			const content = normalized(element.innerText)
			return {text: content.slice(0, 60), words: count(content)}
		})
	const sections = document.querySelectorAll('main > section, [data-slot="section"]').length
	return {
		h1: document.querySelectorAll('h1').length,
		longParagraphs: paragraphs.filter(paragraph => paragraph.words > 25),
		overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
		scrollY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
		sections,
		viewport: `${innerWidth}×${innerHeight}`,
		words: count(text)
	}
})()
