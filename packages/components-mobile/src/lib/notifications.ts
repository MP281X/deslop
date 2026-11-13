import type {NotificationHandler} from 'expo-notifications'

// Foreground notifications have the same sound and presentation policy in every app.
export const foregroundNotifications: NotificationHandler = {
	handleNotification: () =>
		// oxlint-disable-next-line eslint/no-restricted-globals -- expo-notifications' handler contract takes a Promise.
		Promise.resolve({shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true})
}
