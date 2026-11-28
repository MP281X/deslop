declare module 'react-native/Libraries/Linking/Linking' {
	import type * as ReactNative from 'react-native'

	const Linking: typeof ReactNative.Linking
	export default Linking
}

declare module 'react-native/Libraries/Core/setUpXHR'

declare module 'react-native/Libraries/WebSocket/WebSocket' {
	import type {Socket} from 'effect/socket'

	const WebSocket: new (
		url: string,
		protocols?: readonly string[],
		options?: {headers: Readonly<Record<string, string>>}
	) => Socket.WebSocketLike
	export default WebSocket
}

declare module 'react-native/Libraries/Components/Clipboard/Clipboard' {
	const Clipboard: {readonly setString: (value: string) => void}
	export default Clipboard
}
