import ActivityKit
import Capacitor
import Foundation

@objc(OpmNativePlugin)
final class OpmNativePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "OpmNativePlugin"
    let jsName = "OpmNative"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "watchChapterStarts", returnType: CAPPluginReturnPromise)
    ]

    private var observing: Task<Void, Never>?

    deinit { observing?.cancel() }

    @objc func watchChapterStarts(_ call: CAPPluginCall) {
        Task { @MainActor in
            observing?.cancel()
            observing = Task { [weak self] in
                let activity = Activity<ChapterActivityAttributes>.self
                if let token = activity.pushToStartToken {
                    self?.emitToken(token)
                }
                for await token in activity.pushToStartTokenUpdates {
                    guard !Task.isCancelled else { return }
                    self?.emitToken(token)
                }
            }
            call.resolve()
        }
    }

    private func emitToken(_ token: Data) {
        notifyListeners("chapterStartToken", data: ["value": token.map { String(format: "%02x", $0) }.joined()])
    }

    func openChapter(_ url: URL) {
        notifyListeners("chapterOpened", data: ["url": url.absoluteString], retainUntilConsumed: true)
        Task {
            for activity in Activity<ChapterActivityAttributes>.activities where activity.attributes.url == url {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }
}
