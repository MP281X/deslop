// Pass this file's text to preview_evaluate on each captured state; it returns what a reader would flag. It only reads the page.
function auditPage() {
	const paint = document.createElement('canvas').getContext('2d', {willReadFrequently: true})

	function visible(element) {
		const rect = element.getBoundingClientRect()
		const style = getComputedStyle(element)
		// Screen-reader-only text measures 1 px.
		return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.opacity !== '0'
	}
	/** @returns {string} */
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
		/** @type {Map<string, number>} */
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
	// A control stretched over its whole parent, the way a row that opens its content is built.
	function overlay(element) {
		const rect = element.getBoundingClientRect()
		const parent = element.parentElement.getBoundingClientRect()
		return (
			getComputedStyle(element).position === 'absolute' &&
			rect.width * rect.height >= parent.width * parent.height * 0.9
		)
	}
	function overlapping(first, second) {
		if (first.contains(second) || second.contains(first) || overlay(first) || overlay(second)) return false
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
		const pixel = paint.getImageData(0, 0, 1, 1).data
		return [pixel[0], pixel[1], pixel[2], pixel[3] / 255]
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
	// OKLCH lightness 0–1, chroma and hue in degrees, from sRGB channels.
	function oklch(rgb) {
		const linear = rgb.slice(0, 3).map(value => {
			const unit = value / 255
			if (unit <= 0.04045) return unit / 12.92
			return ((unit + 0.055) / 1.055) ** 2.4
		})
		const cone = [
			0.4122 * linear[0] + 0.5363 * linear[1] + 0.0514 * linear[2],
			0.2119 * linear[0] + 0.6807 * linear[1] + 0.1074 * linear[2],
			0.0883 * linear[0] + 0.2817 * linear[1] + 0.63 * linear[2]
		].map(Math.cbrt)
		const a = 1.978 * cone[0] - 2.4286 * cone[1] + 0.4506 * cone[2]
		const b = 0.0259 * cone[0] + 0.7828 * cone[1] - 0.8087 * cone[2]
		return {
			chroma: Math.hypot(a, b),
			hue: (Math.atan2(b, a) * 180) / Math.PI + 360 * Number(b < 0),
			lightness: 0.2105 * cone[0] + 0.7936 * cone[1] - 0.0041 * cone[2]
		}
	}
	function tinted(color) {
		const rgba = channels(color)
		return rgba[3] > 0 && oklch(rgba).chroma > 0.03
	}
	// Pairs of controls that overlap: each is compared with the next fifty by left edge, which bounds the work on a page of thousands.
	function overlaps(elements) {
		const sorted = [...elements].sort(
			(first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left
		)
		return sorted
			.flatMap((first, index) =>
				sorted
					.slice(index + 1, index + 51)
					.filter(second => overlapping(first, second))
					.map(second => `${describe(first)} ↔ ${describe(second)}`)
			)
			.slice(0, 15)
	}

	const all = [...document.querySelectorAll('body *')].filter(visible)
	const controls = all.filter(element =>
		element.matches('button, a[href], [role="button"], [role="menuitem"], [role="tab"], input, select, textarea')
	)
	const loaders = all.filter(element =>
		element.matches('[aria-busy="true"], [data-slot="skeleton"], [role="progressbar"]')
	)
	const errors = all.filter(element =>
		element.matches('[role="alert"], [data-slot="alert"][data-variant="destructive"]')
	)
	const texts = all.filter(element => element.children.length === 0 && textOf(element).length > 1)
	const selected = all.filter(element =>
		element.matches(
			'[aria-selected="true"], [aria-current]:not([aria-current="false"]), [aria-checked="true"], [data-state="active"], [data-state="on"], [data-selected="true"]'
		)
	)
	// The rules AGENTS.md's Design section states that a page can show: hue only for identity and status, no custom animations. Everything else in the result is a defect check. The audit only reads: it never focuses, scrolls or adds an element.
	const design = {
		// "No custom animations": a press scale or translate is one.
		pressScale: [...document.querySelectorAll('[class*="active:scale"], [class*="active:translate"]')].map(describe),
		// "Hue only for identity and status": a selection or a large surface that carries a tint.
		tintedSelection: selected.filter(element => tinted(getComputedStyle(element).backgroundColor)).map(describe),
		tintedSurface: all
			.filter(element => {
				const rect = element.getBoundingClientRect()
				return rect.width * rect.height > innerWidth * innerHeight * 0.15
			})
			.filter(element => tinted(getComputedStyle(element).backgroundColor))
			.map(describe)
	}

	return {
		brokenImages: [...document.images]
			.filter(image => image.complete && image.naturalWidth === 0)
			.map(image => image.src),
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
		design,
		errorWhileLoading: errors
			.filter(
				error =>
					error.closest('[aria-busy="true"]') ||
					loaders.some(loader => regionOf(loader.parentElement || loader) === regionOf(error))
			)
			.map(describe),
		errors: errors.map(describe),
		lowContrast: texts
			.filter(element => !element.closest('[disabled], [aria-disabled="true"]'))
			.filter(element => contrast(element) < 3 || (!large(element) && contrast(element) < 4.5))
			.slice(0, 15)
			.map(element => `${describe(element)} ${contrast(element).toFixed(1)}:1`),
		overlaps: overlaps(controls),
		pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
		repeatedActions: repeated(controls.map(nameOf).filter(Boolean)),
		repeatedText: repeated(texts.map(textOf)),
		unnamed: controls.filter(element => !nameOf(element)).map(describe),
		viewport: `${innerWidth}×${innerHeight}`
	}
}
auditPage()
