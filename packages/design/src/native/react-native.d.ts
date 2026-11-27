declare module 'react-native/Libraries/Core/setUpTimers' {}

declare module 'react-native/Libraries/Linking/Linking' {
	import type * as ReactNative from 'react-native'

	const Linking: typeof ReactNative.Linking
	export default Linking
}
