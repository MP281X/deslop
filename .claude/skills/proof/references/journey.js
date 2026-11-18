// Pass this file's text plus `play(task, [...steps])` to preview_evaluate while the tab records; the proof skill lists the steps.
async function play(task, steps) {
	const head = 56
	const fit = Math.min((innerWidth - 96) / innerWidth, (innerHeight - head - 24) / innerHeight)
	const frame = {
		height: innerHeight * fit,
		left: (innerWidth - innerWidth * fit) / 2,
		top: head,
		width: innerWidth * fit
	}
	document.querySelector('#journey')?.remove()
	const layer = document.createElement('div')
	layer.id = 'journey'
	layer.style.cssText =
		'position:fixed;inset:0;z-index:2147483647;pointer-events:none;color:#fafafa;font:14px/1.4 ui-sans-serif,system-ui,sans-serif'
	layer.innerHTML = `<div style="position:absolute;left:${frame.left}px;top:${frame.top}px;width:${frame.width}px;height:${frame.height}px;border-radius:12px;box-shadow:0 0 0 1px #2a2a2a,0 0 0 100vmax #0c0c0c"></div>
		<div style="position:absolute;left:${frame.left}px;right:${frame.left}px;top:0;height:${head}px;display:flex;align-items:center;gap:12px"><span style="font-weight:500">${task}</span><span style="margin-left:auto;display:flex;gap:3px">${'<i style="width:18px;height:3px;border-radius:2px;background:#ffffff2e;transition:background .3s"></i>'.repeat(steps.length)}</span></div>
		<svg width="20" height="29" viewBox="0 0 13 19" style="position:absolute;left:0;top:0;translate:${innerWidth / 2}px ${innerHeight}px;transition:translate .5s cubic-bezier(.4,0,.2,1)"><path d="M1 1v14.2l3.7-3.5 2.5 5.9 2.3-1-2.5-5.8H12z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>
		<i style="position:absolute;left:-20px;top:-20px;width:40px;height:40px;border-radius:50%;border:2px solid #3b82f6;opacity:0"></i>
		<div style="position:absolute;left:${frame.left + 14}px;top:${frame.top + frame.height - 44}px;padding:5px 14px;border-radius:999px;background:#18181b;color:#fafafa;outline:1px solid #ffffff38;opacity:0;transition:opacity .25s"></div>
		<i style="position:absolute;border-radius:6px;outline:2px solid #3b82f6;outline-offset:2px;opacity:0;transition:opacity .2s"></i>`
	document.documentElement.append(layer)
	const [, header, cursor, ripple, caption, mark] = layer.children
	const beats = [...header.lastElementChild.children]
	const page = document.body.style
	const saved = page.cssText
	// The page is scaled once into the frame and stays still; a viewport-sized body keeps fixed dialogs and bars where the app puts them.
	Object.assign(page, {
		height: '100vh',
		overflow: 'auto',
		transform: `translate(${frame.left}px, ${frame.top}px) scale(${fit})`,
		transformOrigin: '0 0'
	})

	function sleep(ms) {
		return new Promise(resolve => {
			setTimeout(resolve, ms)
		})
	}
	function faded(element) {
		if (!element) return false
		return getComputedStyle(element).opacity === '0' || faded(element.parentElement)
	}
	function shown(element) {
		const rect = element.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden' && !faded(element)
	}
	function words(text) {
		return (text || '').trim().replaceAll(/\s+/gu, ' ')
	}
	function squashed(text) {
		return (text || '').replaceAll(/\s+/gu, '')
	}
	function ownLabel(element) {
		return (
			words(
				(element.getAttribute('aria-labelledby') || '')
					.split(' ')
					.filter(Boolean)
					.map(id => document.getElementById(id)?.textContent)
					.join(' ')
			) || words(element.getAttribute('aria-label'))
		)
	}
	// Content as the accessibility tree reads it: a child's own label stands for its text, hidden children add nothing and a block-level child is a separate word.
	/** @param {Node} node @returns {string} */
	function contentOf(node) {
		if (node instanceof Text) return node.data
		if (!(node instanceof Element) || node.matches('[aria-hidden="true"],script,style,template')) return ''
		const style = getComputedStyle(node)
		if (style.display === 'none' || style.visibility === 'hidden') return ''
		const text = ownLabel(node) || [...node.childNodes].map(contentOf).join('')
		if (style.display.startsWith('inline')) return text
		return ` ${text} `
	}
	// The name the accessibility tree gives a row, cell or control: its labelling, a field's label, its content, then its title or placeholder.
	function nameOf(element) {
		const names = [
			ownLabel(element),
			[...(element.labels || [])].map(label => label.textContent).join(' '),
			contentOf(element),
			element.getAttribute('title'),
			element.getAttribute('placeholder')
		]
		return names.map(words).find(Boolean) || ''
	}
	function query(target, pool) {
		// A target is a CSS selector when it parses as one and uses selector syntax; anything else is a name.
		if (/[#.[:>]/u.test(target) && CSS.supports(`selector(${target})`)) {
			return [...document.querySelectorAll(target)].find(shown)
		}
		const text = squashed(target)
		const hits = [...document.querySelectorAll(pool)].filter(
			element =>
				!layer.contains(element) &&
				(squashed(element.textContent).includes(text) ||
					element.matches('[aria-label],[aria-labelledby],[title],[placeholder]') ||
					element.labels?.length > 0) &&
				nameOf(element) === target &&
				shown(element)
		)
		// The innermost element carrying the name, so a row's button wins over the row.
		return hits.find(element => !hits.some(other => other !== element && element.contains(other)))
	}
	// Targets may still be loading, so each one gets eight seconds to appear.
	/** @param {number} waited */
	async function find(name, pool, waited) {
		const element = query(name, pool)
		if (element) return element
		if (waited >= 8000) throw new Error(`no visible target "${name}"`)
		await sleep(200)
		return find(name, pool, waited + 200)
	}
	/** @param {Element} element */
	async function aim(element) {
		element.scrollIntoView({block: 'nearest', inline: 'nearest'})
		const rect = element.getBoundingClientRect()
		const point = {x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height * 0.6}
		cursor.style.translate = `${point.x}px ${point.y}px`
		ripple.style.translate = cursor.style.translate
		await sleep(550)
		// The highlight is drawn on the overlay: the page's own element is never restyled.
		Object.assign(mark.style, {
			height: `${rect.height}px`,
			left: `${rect.left}px`,
			opacity: '1',
			top: `${rect.top}px`,
			width: `${rect.width}px`
		})
		ripple.animate(
			[
				{opacity: 1, scale: 0.2},
				{opacity: 0, scale: 1}
			],
			{duration: 450, easing: 'ease-out'}
		)
		setTimeout(() => {
			mark.style.opacity = '0'
		}, 700)
		return point
	}
	function enabled(element) {
		if (element.matches(':disabled, [aria-disabled="true"]')) throw new Error('target is disabled')
	}
	/** @param {Element} element @param {{x: number, y: number}} point */
	function tap(element, point) {
		// A synthetic click reaches any element, so what a real pointer would hit decides whether this one counts.
		const hit = document.elementFromPoint(point.x, point.y)
		if (!hit || !(element.contains(hit) || hit.contains(element))) {
			throw new Error('target is covered or outside the visible area')
		}
		const init = {
			bubbles: true,
			button: 0,
			cancelable: true,
			clientX: point.x,
			clientY: point.y,
			composed: true,
			isPrimary: true,
			pointerType: 'mouse'
		}
		element.dispatchEvent(new PointerEvent('pointerdown', init))
		element.dispatchEvent(new MouseEvent('mousedown', init))
		element.dispatchEvent(new PointerEvent('pointerup', init))
		element.dispatchEvent(new MouseEvent('mouseup', init))
		element.focus?.()
		element.click()
	}
	async function click(element) {
		enabled(element)
		tap(element, await aim(element))
	}
	// React tracks a field's value through the prototype's setter, so typing goes through it.
	/** @param {number} end */
	async function typeFrom(element, text, end) {
		if (end > text.length) {
			element.dispatchEvent(new Event('change', {bubbles: true}))
			return
		}
		Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, text.slice(0, end))
		element.dispatchEvent(new InputEvent('input', {bubbles: true, data: text[end - 1], inputType: 'insertText'}))
		await sleep(70)
		await typeFrom(element, text, end + 1)
	}
	function tabbable(from) {
		const order = [
			...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex^="-"])')
		].filter(element => !layer.contains(element) && !element.matches(':disabled') && shown(element))
		return order.at((order.indexOf(from) + 1) % order.length)
	}
	function press(key) {
		const target = document.activeElement || document.body
		const proceed = target.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, cancelable: true, key}))
		target.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true, key}))
		// Synthetic keys run no browser default, so the two defaults a flow relies on are done here unless the app cancelled the key.
		if (proceed && key === 'Enter') {
			if (target.form && target.matches('input')) target.form.requestSubmit()
			else if (target.matches('a[href],button,summary')) target.click()
		}
		if (proceed && key === 'Tab') tabbable(target)?.focus()
	}
	// Typed text is never captioned: a recording must not show a secret or private text.
	function captionOf(step) {
		if (step.label) return step.label
		if (step.type !== undefined) return `Type into ${step.into}`
		if (step.see !== undefined) return step.see
		return step.say ?? step.press ?? step.click
	}
	/** @param {() => boolean} changed @param {number} waited */
	async function waitForChange(changed, waited) {
		if (changed()) return true
		if (waited >= 1500) return false
		await sleep(100)
		return waitForChange(changed, waited + 100)
	}
	// Runs the action and reports whether the page answered it within the wait: a new address, what `extra` sees, or, on a page that was still for the second before, a DOM change outside the overlay. A page that changes on its own cannot show which change is the answer, so `still` is false and the step must name what it shows; an update that happens to land in a still page's wait counts as its answer.
	/** @template T @param {() => T | Promise<T>} prepare @param {(prepared: T) => void} action @param {(prepared: T) => boolean} extra */
	async function responds(prepare, action, extra) {
		const from = location.href
		/** @type {MutationRecord[]} */
		const records = []
		const observer = new MutationObserver(found => {
			records.push(...found)
		})
		observer.observe(document, {attributes: true, characterData: true, childList: true, subtree: true})
		/** @param {MutationRecord} record */
		function shows(record) {
			return record.target.isConnected && !layer.contains(record.target)
		}
		const [prepared] = await Promise.all([prepare(), sleep(1000)])
		records.push(...observer.takeRecords())
		const still = !records.some(shows)
		const before = records.length
		action(prepared)
		const changed = await waitForChange(
			() => location.href !== from || extra(prepared) || (still && records.slice(before).some(shows)),
			0
		)
		observer.disconnect()
		return {changed, still}
	}
	// Why a step without `see` failed: nothing answered, or the page's own changes hide whether anything did.
	function unanswered(still, action) {
		if (still) return `the page did not respond to ${action}`
		return `the page changes on its own, so add \`see\` with the text ${action} should show`
	}
	async function act(step) {
		const targets = 'body *'
		const results = []
		// Text already on the page cannot show what a click or key did.
		if (step.see !== undefined && (step.click ?? step.press) !== undefined && query(step.see, targets)) {
			throw new Error(`"${step.see}" was on the page before the step: name text the step brings`)
		}
		if (step.click !== undefined) {
			const element = await find(step.click, targets, 0)
			const checked = element.checked
			// Only a text field counts focus as a response: any click focuses a button.
			const focuses = element.matches('input,textarea,select') && document.activeElement !== element
			enabled(element)
			const responded = await responds(
				() => aim(element),
				point => {
					tap(element, point)
				},
				() => element.checked !== checked || (focuses && document.activeElement === element)
			)
			// A step that names what it should show is proven by that text instead.
			if (!responded.changed && step.see === undefined) throw new Error(unanswered(responded.still, 'the click'))
			if (responded.changed) results.push('the page responded')
		}
		if (step.type !== undefined) {
			const field = await find(step.into, 'input,textarea', 0)
			await click(field)
			await typeFrom(field, step.type, 1)
			await sleep(150)
			if (field.value !== step.type) throw new Error('the field did not keep the typed text')
			results.push('the field holds the text')
		}
		if (step.press !== undefined) {
			const responded = await responds(
				() => document.activeElement,
				() => {
					press(step.press)
				},
				before => document.activeElement !== before
			)
			if (!responded.changed && step.see === undefined) throw new Error(unanswered(responded.still, step.press))
			if (responded.changed) results.push('the page responded')
		}
		if (step.see !== undefined) {
			await find(step.see, targets, 0)
			results.push('found')
		}
		if (step.say !== undefined) results.push('shown')
		return results.join(', ')
	}
	/** @param {number} index */
	async function run(index, outcomes) {
		if (index === steps.length) return outcomes
		const step = Object.assign(
			{},
			typeof steps[index] === 'string' && {click: steps[index]},
			typeof steps[index] === 'object' && steps[index]
		)
		const label = captionOf(step)
		caption.textContent = label
		caption.style.opacity = '1'
		beats[index].style.background = '#fafafa'
		const result = await act(step).then(
			ok => ({ok}),
			error => ({error: error.message})
		)
		if (result.error !== undefined) return [...outcomes, `${index + 1} ${label}: failed, ${result.error}`]
		await sleep(900)
		return run(index + 1, [...outcomes, `${index + 1} ${label}: ${result.ok}`])
	}

	// The recording starts in the same turn, so the first step waits for it; the last frame stays until it stops.
	await sleep(400)
	const from = Date.now()
	const outcomes = await run(0, [])
	caption.style.opacity = '0'
	await sleep(1200)
	setTimeout(() => {
		layer.remove()
		page.cssText = saved
	}, 5000)
	return {from, outcomes}
}
