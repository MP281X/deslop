import {Array, Record, String, pipe} from 'effect'

import {defineConfig} from 'vite-plus'

import {webConfig} from '@deslop/ui/vite'

import {contacts, experience, profile, projects, summary} from './src/lib/profile.ts'

const config = webConfig(512)
const name = `${profile.firstName} ${profile.lastName}`
const description = `${profile.title}. ${summary}`

function escaped(text: string) {
	return pipe(
		text,
		String.replaceAll('&', '&amp;'),
		String.replaceAll('<', '&lt;'),
		String.replaceAll('>', '&gt;'),
		String.replaceAll('"', '&quot;')
	)
}

function link(target: {href: string; value: string}) {
	return `<a href="${escaped(target.href)}">${escaped(target.value)}</a>`
}

// Link previews and readers that run no script read the HTML alone: it names the person on both routes and carries the profile as plain text, which the app replaces once it runs.
export default defineConfig({
	...config,
	plugins: [
		...config.plugins,
		{
			name: 'portfolio-document',
			transformIndexHtml: () => [
				{children: escaped(`${name} – ${profile.title}`), injectTo: 'head', tag: 'title'},
				{attrs: {content: name, name: 'author'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: description, name: 'description'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: 'profile', property: 'og:type'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: name, property: 'og:title'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: description, property: 'og:description'}, injectTo: 'head', tag: 'meta'},
				{attrs: {content: `https://${profile.portfolio}/`, property: 'og:url'}, injectTo: 'head', tag: 'meta'},
				{
					children: Array.join(
						[
							`<h1>${escaped(name)}</h1>`,
							`<p>${escaped(description)}</p>`,
							`<p>${escaped(profile.location)}</p>`,
							'<h2>Experience</h2><ul>',
							...Array.map(experience, job => `<li>${escaped(`${job.role}, ${job.company} (${job.period})`)}</li>`),
							'</ul><h2>Projects</h2><ul>',
							...Array.map(
								projects,
								project =>
									`<li>${link({href: project.href, value: project.name})}: ${escaped(project.description)}</li>`
							),
							'</ul><h2>Contact</h2><ul>',
							...Array.map(Record.values(contacts), contact => `<li>${escaped(contact.label)}: ${link(contact)}</li>`),
							`<li>${link({href: '/cv', value: 'CV'})}</li></ul>`,
							// Italian law asks a VAT holder's website to show the number on its home page.
							`<p>VAT ${escaped(profile.vat)}</p>`
						],
						''
					),
					injectTo: 'body-prepend',
					tag: 'noscript'
				}
			]
		}
	]
})
