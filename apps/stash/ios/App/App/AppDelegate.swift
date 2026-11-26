import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  private var shareSessions: [String: URLSession] = [:]

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
