// oxlint-disable-next-line @deslop/coding-standards/no-multiline-comment -- Agents read the step syntax from this header, which the visuals skill points to.
// Pass this file's text plus `play([...steps])` to preview_evaluate while the tab records. Steps:
// - 'Name' or {click: 'Name'} clicks the visible element with that accessible name, or a CSS selector (containing #, ., [, : or >).
// - {type, into} types into a field, which must keep the text; {press} presses a key.
// - {see} waits for text the step brings, never a timer. A click passes only if the address or a part of the page that was
// still changes, a key also if focus moves; on a page that changes on its own, such as one with a clock, a step passes only
// through a `see` in it: {click: 'Rename', see: 'New name', label: 'Open rename'}.
// - Each step takes a `label` naming the action and field, never typed or private text.
// A navigation ends the evaluation; the first failed step ends the run.
async function play(steps) {
	// Only a cursor is drawn over the page; the page itself is recorded at its real size, unscaled and unframed.
	document.querySelector('#journey')?.remove()
	const layer = document.createElement('div')
	layer.id = 'journey'
	// A popover sits in the top layer, so the cursor stays above the app's own modal dialogs once raised again.
	layer.popover = 'manual'
	layer.style.cssText =
		'position:fixed;inset:0;width:auto;height:auto;margin:0;padding:0;border:0;background:none;overflow:visible;z-index:2147483647;pointer-events:none'
	layer.innerHTML = `<svg width="20" height="29" viewBox="0 0 13 19" style="position:absolute;left:0;top:0;translate:${innerWidth / 2}px ${innerHeight}px;transition:translate .5s cubic-bezier(.4,0,.2,1)"><path d="M1 1v14.2l3.7-3.5 2.5 5.9 2.3-1-2.5-5.8H12z" fill="#f5f5f5" stroke="#0a0a0a" stroke-width="1.2" stroke-linejoin="round"/></svg>`
	document.documentElement.append(layer)
	layer.showPopover()
	const [cursor] = layer.children
	/** @type {{parts: number[][], place: string, press: number, rect: number[]}[]} */
	const taps = []

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
	// A step matches another only by name and kind of place: a field in a dialog is not the same field inline.
	/** @param {Element} element */
	function placeOf(element) {
		const within = element.closest('dialog,[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')
		if (!within) return 'page'
		return `${within.getAttribute('role') || 'dialog'} ${ownLabel(within)}`.trim()
	}
	// The row around a target, so the cut doesn't slice through the text beside it.
	/** @param {Element} element @param {DOMRect} rect */
	function line(element, rect) {
		const row = element.parentElement?.getBoundingClientRect()
		if (!row || row.height > rect.height * 3) return []
		return [[row.left, row.top, row.right, row.bottom]]
	}
	/** @param {Element} element */
	async function aim(element) {
		element.scrollIntoView({block: 'nearest', inline: 'nearest'})
		const rect = element.getBoundingClientRect()
		const point = {x: rect.left + Math.min(rect.width / 2, 80), y: rect.top + rect.height * 0.6}
		layer.hidePopover()
		layer.showPopover()
		cursor.style.translate = `${point.x}px ${point.y}px`
		await sleep(550)
		const box = [rect.left, rect.top, rect.right, rect.bottom]
		taps.push({parts: [box, ...line(element, rect)], place: placeOf(element), press: Date.now(), rect: box})
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
		try {
			const [prepared] = await Promise.all([prepare(), sleep(1000)])
			records.push(...observer.takeRecords())
			const still = !records.some(shows)
			const before = records.length
			action(prepared)
			const changed = await waitForChange(
				() => location.href !== from || extra(prepared) || (still && records.slice(before).some(shows)),
				0
			)
			return {changed, still}
		} finally {
			observer.disconnect()
		}
	}
	// Why a step without `see` failed: nothing answered, or the page's own changes hide whether anything did.
	function unanswered(still, action) {
		if (still) return `the page did not respond to ${action}`
		return `the page changes on its own, so add \`see\` with the text ${action} should show`
	}
	async function act(step) {
		const targets = 'body *'
		const results = []
		// Text already on the page cannot show what a click or key did, so it is looked for at the last moment before the action.
		function unseen() {
			if (step.see !== undefined && query(step.see, targets)) {
				throw new Error(`"${step.see}" was on the page before the step: name text the step brings`)
			}
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
					unseen()
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
					unseen()
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
	async function run(index, outcomes, marks) {
		if (index === steps.length) return {marks, outcomes}
		const step = Object.assign(
			{},
			typeof steps[index] === 'string' && {click: steps[index]},
			typeof steps[index] === 'object' && steps[index]
		)
		const label = captionOf(step)
		const start = Date.now()
		const focused = placeOf(document.activeElement ?? document.body)
		taps.splice(0)
		const result = await act(step).then(
			ok => ({ok}),
			error => ({error: error.message})
		)
		if (result.error !== undefined) {
			return {marks, outcomes: [...outcomes, `${index + 1} ${label}: failed, ${result.error}`]}
		}
		await sleep(900)
		const pressed = taps.at(-1)
		// What the step left open stays in frame when the recording is cut.
		const open = [
			...document.querySelectorAll(
				'dialog[open],[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],:popover-open'
			)
		]
			.filter(element => !layer.contains(element) && shown(element))
			.map(element => {
				const rect = element.getBoundingClientRect()
				return [rect.left, rect.top, rect.right, rect.bottom]
			})
		marks.push({
			end: Date.now(),
			key: `${label} @ ${pressed?.place ?? focused}`,
			label,
			parts: [...(pressed?.parts ?? []), ...open],
			press: pressed?.press,
			rect: pressed?.rect,
			start
		})
		return run(index + 1, [...outcomes, `${index + 1} ${label}: ${result.ok}`], marks)
	}

	// The recording starts in the same turn, so the first step waits for it; the last frame stays until it stops.
	await sleep(400)
	const ran = await run(0, [], [])
	setTimeout(() => {
		layer.remove()
	}, 5000)
	return {marks: ran.marks, outcomes: ran.outcomes, viewport: [innerWidth, innerHeight]}
}
