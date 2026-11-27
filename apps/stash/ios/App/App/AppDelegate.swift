import ActivityKit
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  private var shareSessions: [String: URLSession] = [:]

  func application(
    _ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    if let store = try? ShareStore(app: .main) {
      Task {
        if let token = Activity<SaveActivityAttributes>.pushToStartToken {
          store.pushToStartToken = token.hex
        }
        for await token in Activity<SaveActivityAttributes>.pushToStartTokenUpdates {
          store.pushToStartToken = token.hex
        }
      }
    }
    Task {
      await withTaskGroup(of: Void.self) { group in
        for activity in Activity<SaveActivityAttributes>.activities {
          group.addTask { await Self.register(activity) }
        }
        for await activity in Activity<SaveActivityAttributes>.activityUpdates {
          group.addTask { await Self.register(activity) }
        }
      }
    }
    return true
  }

  private static func register(_ activity: Activity<SaveActivityAttributes>) async {
    if let token = activity.pushToken { await send(token, captureId: activity.attributes.captureId) }
    for await token in activity.pushTokenUpdates {
      await send(token, captureId: activity.attributes.captureId)
    }
  }

  // Starting a Live Activity via push wakes the app briefly to register that activity's update token.
  private static func send(_ token: Data, captureId: UUID) async {
    guard let server = try? StashServer(app: .main),
      let body = try? JSONEncoder().encode(["token": token.hex])
    else { return }
    var request = server.request(
      "api/capture/\(captureId.uuidString.lowercased())/activity", method: "POST", type: "application/json")
    request.httpBody = body
    request.timeoutInterval = 10
    _ = try? await URLSession.shared.data(for: request)
  }

  func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard let store = try? ShareStore(app: .main), identifier.hasPrefix("\(store.group).share.") else {
      completionHandler()
      return
    }
    let recorder = ShareUploadRecorder(folder: store.folder) { [weak self] in
      self?.shareSessions.removeValue(forKey: identifier)?.finishTasksAndInvalidate()
      completionHandler()
    }
    shareSessions[identifier] = URLSession(
      configuration: store.backgroundConfiguration(identifier), delegate: recorder, delegateQueue: nil)
  }
}

private extension Data {
  var hex: String { map { String(format: "%02x", $0) }.joined() }
}
