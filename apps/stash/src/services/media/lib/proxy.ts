import {Config, String} from 'effect'

// When set, every read of a source exits through this proxy, so sites never see the server's address; `{session}` keeps one exit address per request.
export const sourceProxy = Config.option(Config.String('STASH_PROXY'))

export function sticky(proxy: string, session: string) {
	return String.replaceAll('{session}', session)(proxy)
}
