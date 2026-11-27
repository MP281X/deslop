import ActivityKit
import ExpoModulesCore
import UIKit

public final class TripsActivityModule: Module {
    private var observing: Task<Void, Never>?

    public func definition() -> ModuleDefinition {
        Name("TripsActivity")
        Events("activityToken")

        AsyncFunction("device") { () in
            [
                "bundle": Bundle.main.bundleIdentifier,
                "phone": UIDevice.current.identifierForVendor?.uuidString,
            ]
        }.runOnQueue(.main)

        OnStartObserving("activityToken") {
            self.observing = Task { [weak self] in
                if let token = Activity<LiveActivityAttributes>.pushToStartToken {
                    self?.send(token)
                }
                for await token in Activity<LiveActivityAttributes>.pushToStartTokenUpdates {
                    guard !Task.isCancelled else { return }
                    self?.send(token)
                }
            }
        }

        OnStopObserving("activityToken") {
            self.observing?.cancel()
            self.observing = nil
        }
    }

    private func send(_ token: Data) {
        sendEvent("activityToken", ["value": token.map { String(format: "%02x", $0) }.joined()])
    }
}
