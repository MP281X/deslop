import ActivityKit
internal import ExpoModulesCore
import Foundation

final class ChapterActivities: Module {
    private var observing: Task<Void, Never>?

    func definition() -> ModuleDefinition {
        Events("chapterStartToken")

        OnStartObserving("chapterStartToken") {
            self.observing = Task { @MainActor [weak self] in
                guard #available(iOS 17.2, *) else { return }
                let activity = Activity<ChapterActivityAttributes>.self
                if let token = activity.pushToStartToken { self?.publish(token) }
                for await token in activity.pushToStartTokenUpdates {
                    guard !Task.isCancelled else { return }
                    self?.publish(token)
                }
            }
        }

        OnStopObserving("chapterStartToken") {
            self.observing?.cancel()
            self.observing = nil
        }

        AsyncFunction("opened") { (link: String) in
            guard let url = URL(string: link) else { return }
            for activity in Activity<ChapterActivityAttributes>.activities where activity.attributes.url == url {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private func publish(_ token: Data) {
        sendEvent("chapterStartToken", ["value": token.map { String(format: "%02x", $0) }.joined()])
    }
}
