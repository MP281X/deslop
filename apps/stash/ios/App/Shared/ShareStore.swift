import Foundation
import Security

struct StashServer: Sendable {
  private let origin: URL
  private let keychainGroup: String

  init(app: Bundle) throws {
    guard
      let address = app.object(forInfoDictionaryKey: "DeslopServer") as? String,
      let origin = URL(string: address), origin.host != nil, origin.path.isEmpty,
      origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
      let keychainGroup = app.object(forInfoDictionaryKey: "DeslopKeychainGroup") as? String,
      !keychainGroup.isEmpty
    else {
      throw URLError(.badURL)
    }
    #if DEBUG
    guard origin.scheme == "https" || origin.scheme == "http" else { throw URLError(.badURL) }
    #else
    guard origin.scheme == "https" else { throw URLError(.badURL) }
    #endif
    self.origin = origin
    self.keychainGroup = keychainGroup
  }

  func request(_ path: String, method: String, type: String? = nil) -> URLRequest {
    var request = URLRequest(url: origin.appendingPathComponent(path))
    request.httpMethod = method
    request.setValue(type, forHTTPHeaderField: "Content-Type")
    request.httpShouldHandleCookies = false
    // Auth already recognizes a tailnet device; otherwise both targets read the session from the shared Keychain.
    if let secret = secret() {
      request.setValue("__Secure-deslop-session=\(secret)", forHTTPHeaderField: "Cookie")
    }
    return request
  }

  private func secret() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "Deslop",
      kSecAttrAccount as String: "session",
      kSecAttrAccessGroup as String: keychainGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var value: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data,
      let text = String(data: data, encoding: .utf8), !text.isEmpty
    else {
      return nil
    }
    return text
  }
}

struct ShareStore: Sendable {
  let group: String
  let folder: URL
  private let server: StashServer

  init(app: Bundle) throws {
    guard
      let identifier = app.bundleIdentifier,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.\(identifier)")
    else {
      throw CocoaError(.featureUnsupported)
    }
    group = "group.\(identifier)"
    folder = container.appendingPathComponent("uploads", isDirectory: true)
    server = try StashServer(app: app)
  }

  func request(_ path: String, type: String) -> URLRequest {
    server.request(path, method: "POST", type: type)
  }

  func backgroundConfiguration(_ identifier: String) -> URLSessionConfiguration {
    let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
    configuration.sharedContainerIdentifier = group
    configuration.isDiscretionary = false
    configuration.timeoutIntervalForResource = 86_400
    return configuration
  }
}

// The extension or the app's background wake records the answer alongside the body it sent.
struct ShareAnswer: Codable {
  let message: String
  let status: Int

  init(data: Data, response: URLResponse?) {
    message = String(decoding: data.prefix(1_000), as: UTF8.self)
    status = (response as? HTTPURLResponse)?.statusCode ?? 0
  }

  static func file(for body: URL) -> URL {
    body.appendingPathExtension("outcome")
  }

  var accepted: Bool { (200..<300).contains(status) || status == 410 }
  var final: Bool { (400..<500).contains(status) && status != 401 && status != 403 }
}

final class ShareUploadRecorder: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let folder: URL
  private let finished: (() -> Void)?
  // Each instance belongs to one session, whose default delegate queue is serial.
  private var answers: [Int: Data] = [:]

  init(folder: URL, finished: (() -> Void)? = nil) {
    self.folder = folder
    self.finished = finished
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    let identifier = dataTask.taskIdentifier
    let remaining = 1_000 - (answers[identifier]?.count ?? 0)
    answers[identifier, default: Data()].append(data.prefix(remaining))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let data = answers.removeValue(forKey: task.taskIdentifier) ?? Data()
    guard let name = task.taskDescription else { return }
    let answer = ShareAnswer(data: data, response: error == nil ? task.response : nil)
    if let encoded = try? JSONEncoder().encode(answer) {
      try? encoded.write(to: ShareAnswer.file(for: folder.appendingPathComponent(name)), options: .atomic)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    if let finished { DispatchQueue.main.async { finished() } }
  }
}
