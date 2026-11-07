// Pass this file's text to preview_evaluate on each captured state; it returns what a reader would flag.
;(() => {
	const visible = element => {
		const rect = element.getBoundingClientRect()
		const style = getComputedStyle(element)
		return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0'
	}
	const textOf = element => (element.innerText || '').trim().replaceAll(/\s+/gu, ' ')
	const describe = element => {
		const slot = element.getAttribute('data-slot')
		const label = element.getAttribute('aria-label')
		const text = textOf(element).slice(0, 40)
		return [element.tagName.toLowerCase(), slot && `[${slot}]`, label && `"${label}"`, !label && text && `“${text}”`]
			.filter(Boolean)
			.join(' ')
	}
	const repeated = values => {
		const counts = new Map()
		for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
		return [...counts]
			.filter(([, count]) => count > 1)
			.sort((left, right) => right[1] - left[1])
			.slice(0, 15)
			.map(([value, count]) => `${count}× ${value.slice(0, 40)}`)
	}
	const all = [...document.querySelectorAll('body *')].filter(visible)

	const cut = all
		.filter(element => {
			const style = getComputedStyle(element)
			const clips = ['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis'
			return clips && element.scrollWidth > element.clientWidth + 1 && textOf(element)
		})
		.map(describe)

	const leaves = all.filter(element => element.children.length === 0 && textOf(element).length > 1)

	const controls = all.filter(element =>
		element.matches('button, a[href], [role="button"], [role="menuitem"], input, select, textarea')
	)
	const labelledBy = element =>
		(element.getAttribute('aria-labelledby') || '')
			.split(' ')
			.map(id => document.getElementById(id))
			.filter(Boolean)
			.map(textOf)
			.join(' ')
	const nameOf = element =>
		element.getAttribute('aria-label') ||
		labelledBy(element) ||
		[...(element.labels || [])].map(textOf).join(' ') ||
		textOf(element) ||
		element.getAttribute('title') ||
		element.getAttribute('placeholder') ||
		''

	const overlaps = controls.flatMap((first, index) =>
		controls
			.slice(index + 1)
			.filter(second => {
				if (first.contains(second) || second.contains(first)) return false
				const a = first.getBoundingClientRect()
				const b = second.getBoundingClientRect()
				const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
				const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
				return overlapX > 2 && overlapY > 2
			})
			.map(second => `${describe(first)} ↔ ${describe(second)}`)
	)

	const loadingSelector = '[aria-busy="true"], [data-slot="skeleton"], [role="progressbar"]'
	const errorElements = all.filter(element =>
		element.matches('[role="alert"], [data-slot="alert"][data-variant="destructive"]')
	)
	const regionOf = element =>
		element.closest('[role="region"], [role="dialog"], section, article, main, [data-slot="card"]') || document.body
	const errorWhileLoading = errorElements
		.filter(element => [...regionOf(element).querySelectorAll(loadingSelector)].some(visible))
		.map(describe)

	return {
		brokenImages: [...document.images]
			.filter(image => image.complete && image.naturalWidth === 0)
			.map(image => image.src),
		cut,
		errorWhileLoading,
		errors: errorElements.map(describe),
		overlaps: overlaps.slice(0, 15),
		pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
		repeatedActions: repeated(controls.map(nameOf).filter(Boolean)),
		repeatedText: repeated(leaves.map(textOf)),
		unnamed: controls.filter(element => !nameOf(element)).map(describe),
		viewport: `${innerWidth}×${innerHeight}`
	}
})()
