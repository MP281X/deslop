import ActivityKit
import Capacitor
import UIKit
import UserNotifications

@objc(TripsNativePlugin)
final class TripsNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "TripsNativePlugin"
    let jsName = "TripsNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "device", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "watchActivityToken", returnType: CAPPluginReturnPromise)
    ]

    private var observing: Task<Void, Never>?

    deinit { observing?.cancel() }

    @objc func device(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let bundle = Bundle.main.bundleIdentifier, let phone = UIDevice.current.identifierForVendor?.uuidString
            else {
                call.reject("iOS did not name this iPhone.")
                return
            }
            call.resolve(["bundle": bundle, "phone": phone])
        }
    }

    @objc func prepareNotifications(_ call: CAPPluginCall) {
        let directions = UNNotificationAction(identifier: "directions", title: "Directions", options: .foreground)
        let uber = UNNotificationAction(identifier: "uber", title: "Uber", options: .foreground)
        let leave = UNNotificationCategory(identifier: "leave", actions: [directions, uber], intentIdentifiers: [], options: [])
        UNUserNotificationCenter.current().setNotificationCategories([leave])
        call.resolve()
    }

    @objc func watchActivityToken(_ call: CAPPluginCall) {
        Task { @MainActor in
            observing?.cancel()
            observing = Task { [weak self] in
                var latest = Activity<LiveActivityAttributes>.pushToStartToken
                if let latest { self?.send(latest) }
                for await token in Activity<LiveActivityAttributes>.pushToStartTokenUpdates {
                    guard !Task.isCancelled else { return }
                    if latest == token { continue }
                    latest = token
                    self?.send(token)
                }
            }
            call.resolve()
        }
    }

    private func send(_ token: Data) {
        notifyListeners("activityToken", data: ["value": token.map { String(format: "%02x", $0) }.joined()])
    }
}
