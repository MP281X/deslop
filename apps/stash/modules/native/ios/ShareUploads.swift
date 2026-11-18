import ExpoModulesCore
import UIKit

// The App Group folder where the share extension stages bodies it sends in the background, and where each answer is recorded.
func sharedUploads() -> URL? {
  guard let identifier = Bundle.main.bundleIdentifier else { return nil }
  return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.\(identifier)")?
    .appendingPathComponent("uploads", isDirectory: true)
}

// iOS wakes Stash with the answers to uploads the share extension started after its sheet closed.
public final class ShareUploadsSubscriber: ExpoAppDelegateSubscriber {
  private let answers = ShareAnswers()

  public func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard let app = Bundle.main.bundleIdentifier, identifier.hasPrefix("group.\(app).share.") else {
      // Expo waits for every subscriber before it tells iOS the events are handled.
      completionHandler()
      return
    }
    answers.reconnect(identifier, group: "group.\(app)", finished: completionHandler)
  }
}

// Each answer is written as `<body>.outcome`, the form the extension's own recorder writes, and the app acts on it in JavaScript.
private final class ShareAnswers: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var answers: [Int: Data] = [:]
  private var finished: [String: () -> Void] = [:]
  private var sessions: [String: URLSession] = [:]

  func reconnect(_ identifier: String, group: String, finished handler: @escaping () -> Void) {
    let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
    configuration.sharedContainerIdentifier = group
    lock.withLock {
      finished[identifier] = handler
      sessions[identifier] = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.withLock { answers[dataTask.taskIdentifier, default: Data()].append(data.prefix(1_000)) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let answer = lock.withLock { answers.removeValue(forKey: task.taskIdentifier) } ?? Data()
    guard let name = task.taskDescription, let folder = sharedUploads() else { return }
    let status = error == nil ? (task.response as? HTTPURLResponse)?.statusCode ?? 0 : 0
    let outcome: [String: Any] = ["message": String(decoding: answer.prefix(1_000), as: UTF8.self), "status": status]
    if let data = try? JSONSerialization.data(withJSONObject: outcome) {
      try? data.write(to: folder.appendingPathComponent("\(name).outcome"), options: .atomic)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    guard let identifier = session.configuration.identifier else { return }
    let handler = lock.withLock {
      sessions.removeValue(forKey: identifier)?.finishTasksAndInvalidate()
      return finished.removeValue(forKey: identifier)
    }
    DispatchQueue.main.async { handler?() }
  }
}
