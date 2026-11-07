// Pass this file's text to preview_evaluate on each captured state; it returns what a reader would flag.
;(() => {
	const paint = document.createElement('canvas').getContext('2d', {willReadFrequently: true})

	function visible(element) {
		const rect = element.getBoundingClientRect()
		const style = getComputedStyle(element)
		// Screen-reader-only text measures 1 px.
		return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.opacity !== '0'
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
	function counted(values) {
		const counts = new Map()
		for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
		return [...counts.entries()].sort((left, right) => right[1] - left[1])
	}
	function repeated(values) {
		return counted(values)
			.filter(entry => entry[1] > 1)
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
	// Any CSS color, oklch included, as sRGB channels 0–255 and alpha 0–1.
	function channels(color) {
		paint.clearRect(0, 0, 1, 1)
		paint.fillStyle = color
		paint.fillRect(0, 0, 1, 1)
		const data = paint.getImageData(0, 0, 1, 1).data
		return [data[0], data[1], data[2], data[3] / 255]
	}
	function over(top, bottom) {
		return [0, 1, 2].map(index => top[index] * top[3] + bottom[index] * (1 - top[3]))
	}
	// The opaque color behind an element: every ancestor's background composited from the root down onto white.
	function backdrop(element) {
		if (!element) return [255, 255, 255]
		return over(channels(getComputedStyle(element).backgroundColor), backdrop(element.parentElement))
	}
	function luminance(rgb) {
		const linear = rgb.map(value => {
			const unit = value / 255
			if (unit <= 0.04045) return unit / 12.92
			return ((unit + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
	}
	function ratio(first, second) {
		return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
	}
	function contrast(element) {
		const behind = backdrop(element)
		return ratio(luminance(over(channels(getComputedStyle(element).color), behind)), luminance(behind))
	}
	function large(element) {
		const style = getComputedStyle(element)
		const size = Number.parseFloat(style.fontSize)
		return size >= 24 || (size >= 18.66 && Number.parseInt(style.fontWeight, 10) >= 700)
	}
	function ring(element) {
		const style = getComputedStyle(element)
		return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.boxShadow} ${style.borderColor}`
	}
	// Children of one row that sit 1–4 px off each other's centre, or of one column off each other's left edge.
	function offBy(container) {
		const style = getComputedStyle(container)
		const children = [...container.children].filter(
			child => visible(child) && getComputedStyle(child).position !== 'absolute'
		)
		if (!style.display.includes('flex') || style.flexWrap !== 'nowrap' || children.length < 2) return 0
		const edges = children.map(child => {
			const rect = child.getBoundingClientRect()
			if (style.flexDirection.startsWith('row')) return rect.top + rect.height / 2
			return rect.left
		})
		const spread = Math.max(...edges) - Math.min(...edges)
		if (style.flexDirection.startsWith('column') && style.alignItems !== 'flex-start' && style.alignItems !== 'start') {
			return 0
		}
		if (spread >= 1 && spread <= 4) return Math.round(spread * 10) / 10
		return 0
	}

	function drift(elements) {
		const looks = new Map()
		for (const element of elements) {
			const style = getComputedStyle(element)
			const key = [
				element.getAttribute('data-slot'),
				element.getAttribute('data-variant'),
				element.getAttribute('data-size')
			]
				.filter(Boolean)
				.join('/')
			const look = `h${Math.round(element.getBoundingClientRect().height)} ${style.fontSize} r${style.borderTopLeftRadius} px${style.paddingLeft}`
			looks.set(key, new Set([...(looks.get(key) || []), look]))
		}
		return [...looks.entries()]
			.filter(entry => entry[1].size > 1)
			.map(entry => `${entry[0]}: ${[...entry[1]].join(' | ')}`)
	}

	const all = [...document.querySelectorAll('body *')].filter(visible)
	const controls = all.filter(element =>
		element.matches('button, a[href], [role="button"], [role="menuitem"], [role="tab"], input, select, textarea')
	)
	const enabled = controls.filter(element => !element.closest('[disabled], [aria-disabled="true"], [inert]'))
	const loaders = all.filter(element =>
		element.matches('[aria-busy="true"], [data-slot="skeleton"], [role="progressbar"]')
	)
	const errors = all.filter(element =>
		element.matches('[role="alert"], [data-slot="alert"][data-variant="destructive"]')
	)
	const texts = all.filter(element => element.children.length === 0 && textOf(element).length > 1)
	const styled = all.filter(element => {
		const style = getComputedStyle(element)
		return channels(style.backgroundColor)[3] > 0 || Number.parseFloat(style.borderTopWidth) > 0
	})
	// Focuses each control as the keyboard would, then hands focus back to whatever held it.
	function ringless(elements, previous) {
		const missing = elements.filter(element => {
			const resting = ring(element)
			element.focus({focusVisible: true, preventScroll: true})
			const shown = document.activeElement !== element || ring(element) !== resting
			element.blur()
			return !shown
		})
		if (previous instanceof HTMLElement) previous.focus({preventScroll: true})
		return missing
	}

	return {
		brokenImages: [...document.images]
			.filter(image => image.complete && image.naturalWidth === 0)
			.map(image => image.src),
		// A shadcn component of one slot, variant and size that renders at more than one height, type size, radius or padding was restyled somewhere.
		componentDrift: drift(
			all.filter(element => element.hasAttribute('data-slot') && element.getBoundingClientRect().height <= 64)
		),
		cut: all
			.filter(element => {
				const style = getComputedStyle(element)
				const clipsX =
					(['hidden', 'clip'].includes(style.overflowX) || style.textOverflow === 'ellipsis') &&
					element.scrollWidth > element.clientWidth + 1
				const clipsY = ['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1
				return (clipsX || clipsY) && textOf(element)
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
		// Every type size and corner radius on the page with its count; a size or radius used once or twice is usually a one-off.
		fontSizes: counted(texts.map(element => getComputedStyle(element).fontSize)).map(
			entry => `${entry[0]}×${entry[1]}`
		),
		lowContrast: texts
			.filter(element => !element.closest('[disabled], [aria-disabled="true"]'))
			.filter(element => contrast(element) < 3 || (!large(element) && contrast(element) < 4.5))
			.slice(0, 15)
			.map(element => `${describe(element)} ${contrast(element).toFixed(1)}:1`),
		misaligned: all
			.filter(element => offBy(element) > 0)
			.slice(0, 15)
			.map(element => `${describe(element)} off by ${offBy(element)}px`),
		noFocusRing: ringless(enabled.slice(0, 80), document.activeElement).map(describe),
		overlaps: controls
			.flatMap((first, index) =>
				controls
					.slice(index + 1)
					.filter(second => overlapping(first, second))
					.map(second => `${describe(first)} ↔ ${describe(second)}`)
			)
			.slice(0, 15),
		pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
		radii: counted(
			styled
				.map(element => Number.parseFloat(getComputedStyle(element).borderTopLeftRadius))
				.filter(radius => radius > 0)
				.map(radius => {
					if (radius > 999) return 'full'
					return `${radius}px`
				})
		).map(entry => `${entry[0]}×${entry[1]}`),
		repeatedActions: repeated(controls.map(nameOf).filter(Boolean)),
		repeatedText: repeated(texts.map(textOf)),
		smallTargets: enabled
			.filter(() => innerWidth < 640)
			.filter(element => !(element.matches('a') && textOf(element.parentElement).length > textOf(element).length + 1))
			.filter(element => element.getBoundingClientRect().width < 44 || element.getBoundingClientRect().height < 44)
			.slice(0, 15)
			.map(element => {
				const rect = element.getBoundingClientRect()
				return `${describe(element)} ${Math.round(rect.width)}×${Math.round(rect.height)}`
			}),
		tinyText: texts.filter(element => Number.parseFloat(getComputedStyle(element).fontSize) < 12).map(describe),
		unnamed: controls.filter(element => !nameOf(element)).map(describe),
		viewport: `${innerWidth}×${innerHeight}`
	}
})()
