// Pass this file's text to preview_evaluate on each captured state; it returns what a reader would flag.
;(() => {
	function visible(element) {
		const rect = element.getBoundingClientRect()
		const style = getComputedStyle(element)
		return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
	}
	function textOf(element) {
		return (element.innerText || '').trim().replaceAll(/\s+/gu, ' ')
	}
	function describe(element) {
		const slot = element.getAttribute('data-slot')
		const label = element.getAttribute('aria-label')
		const text = textOf(element).slice(0, 40)
		return [element.tagName.toLowerCase(), slot && `[${slot}]`, label && `"${label}"`, !label && text && `“${text}”`]
			.filter(Boolean)
			.join(' ')
	}
	function repeated(values) {
		const counts = new Map()
		for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
		return [...counts.entries()]
			.filter(entry => entry[1] > 1)
			.sort((left, right) => right[1] - left[1])
			.slice(0, 15)
			.map(entry => `${entry[1]}× ${entry[0].slice(0, 40)}`)
	}
	function labelledBy(element) {
		return (element.getAttribute('aria-labelledby') || '')
			.split(' ')
			.map(id => document.getElementById(id))
			.filter(Boolean)
			.map(textOf)
			.join(' ')
	}
	function nameOf(element) {
		return (
			element.getAttribute('aria-label') ||
			labelledBy(element) ||
			[...(element.labels || [])].map(textOf).join(' ') ||
			textOf(element) ||
			element.getAttribute('title') ||
			element.getAttribute('placeholder') ||
			''
		)
	}
	function overlapping(first, second) {
		if (first.contains(second) || second.contains(first)) return false
		const a = first.getBoundingClientRect()
		const b = second.getBoundingClientRect()
		const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
		const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
		return overlapX > 2 && overlapY > 2
	}
	function regionOf(element) {
		return (
			element.closest('[role="region"], [role="dialog"], section, article, main, [data-slot="card"]') || document.body
		)
	}

	const all = [...document.querySelectorAll('body *')].filter(visible)
	const controls = all.filter(element =>
		element.matches('button, a[href], [role="button"], [role="menuitem"], input, select, textarea')
	)
	const loaders = all.filter(element =>
		element.matches('[aria-busy="true"], [data-slot="skeleton"], [role="progressbar"]')
	)
	const errors = all.filter(element =>
		element.matches('[role="alert"], [data-slot="alert"][data-variant="destructive"]')
	)

	return {
		brokenImages: [...document.images]
			.filter(image => image.complete && image.naturalWidth === 0)
			.map(image => image.src),
		cut: all
			.filter(element => {
				const style = getComputedStyle(element)
				return (
					(['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis') &&
					element.scrollWidth > element.clientWidth + 1 &&
					textOf(element)
				)
			})
			.map(describe),
		errorWhileLoading: errors
			.filter(
				error =>
					error.closest('[aria-busy="true"]') ||
					loaders.some(loader => regionOf(loader.parentElement || loader) === regionOf(error))
			)
			.map(describe),
		errors: errors.map(describe),
		overlaps: controls
			.flatMap((first, index) =>
				controls
					.slice(index + 1)
					.filter(second => overlapping(first, second))
					.map(second => `${describe(first)} ↔ ${describe(second)}`)
			)
			.slice(0, 15),
		pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
		repeatedActions: repeated(controls.map(nameOf).filter(Boolean)),
		repeatedText: repeated(
			all.filter(element => element.children.length === 0 && textOf(element).length > 1).map(textOf)
		),
		unnamed: controls.filter(element => !nameOf(element)).map(describe),
		viewport: `${innerWidth}×${innerHeight}`
	}
})()
