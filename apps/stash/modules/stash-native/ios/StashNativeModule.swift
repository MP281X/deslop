import ExpoModulesCore
import Foundation
import UIKit

public final class StashNativeModule: Module {
  private let pending = PendingShares()

  public func definition() -> ModuleDefinition {
    Name("StashNative")

    Function("readSession") {
      try StashServer(app: .main).secret()
    }

    Function("writeSession") { (secret: String?) in
      try StashServer(app: .main).writeSecret(secret)
    }

    Function("readDraft") {
      UserDefaults.standard.string(forKey: "stash.draft") ?? ""
    }

    Function("writeDraft") { (text: String) in
      UserDefaults.standard.set(text, forKey: "stash.draft")
    }

    AsyncFunction("settleShares") { [pending] in
      try await pending.settle()
    }

    AsyncFunction("image") { (path: String) in
      let image = try await StashPhotos.image(at: path)
      return ["data": image.data, "type": image.type]
    }

    AsyncFunction("saveImage") { (id: String, data: String) in
      try await StashPhotos.save(id: id, encoded: data)
    }

    AsyncFunction("paste") { () async throws -> [String: String] in
      try await MainActor.run {
        let board = UIPasteboard.general
        if board.hasImages, let image = board.image {
          guard let jpeg = image.jpegData(compressionQuality: 0.85) else {
            throw CocoaError(.fileReadCorruptFile)
          }
          guard jpeg.count <= StashPhotos.maxBytes else {
            throw NSError(domain: "Stash", code: 413,
              userInfo: [NSLocalizedDescriptionKey: "Stash takes pasted images up to 20 MB."])
          }
          return ["image": jpeg.base64EncodedString()]
        }
        return ["text": board.url?.absoluteString ?? board.string ?? ""]
      }
    }
  }
}

private enum StashPhotos {
  static let maxBytes = 20_000_000
  private static let types: Set<String> = ["image/gif", "image/jpeg", "image/png", "image/webp"]
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    return URLSession(configuration: configuration, delegate: StashPhotoSessionDelegate(), delegateQueue: nil)
  }()

  static func image(at path: String) async throws -> (data: String, type: String) {
    guard let route = imageRoute(path) else { throw URLError(.badURL) }
    let request = try StashServer(app: .main).request(route, method: "GET")
    let (data, response) = try await session.data(for: request)
    let answer = try successful(data, response: response)
    guard let type = answer.mimeType?.lowercased(), types.contains(type) else {
      throw URLError(.cannotDecodeContentData)
    }
    return (data.base64EncodedString(), type)
  }

  static func save(id: String, encoded: String) async throws {
    guard UUID(uuidString: id) != nil else { throw URLError(.badURL) }
    guard encoded.utf8.count <= ((maxBytes + 2) / 3) * 4 else {
      throw refusal("Stash takes pasted images up to 20 MB.", status: 413)
    }
    guard let bytes = Data(base64Encoded: encoded), bytes.starts(with: [0xff, 0xd8, 0xff]) else {
      throw refusal("Paste a JPEG image.", status: 422)
    }
    guard bytes.count <= maxBytes else {
      throw refusal("Stash takes pasted images up to 20 MB.", status: 413)
    }
    let request = try StashServer(app: .main).request("api/files/\(id)", method: "POST", type: "image/jpeg")
    let (data, response) = try await session.upload(for: request, from: bytes)
    _ = try successful(data, response: response)
  }

  // Rebuild the wire path from validated pieces; the web view cannot supply an origin, query or a different route.
  private static func imageRoute(_ path: String) -> String? {
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    guard parts.count == 4 || parts.count == 6, parts[0].isEmpty, parts[1] == "api",
      UUID(uuidString: String(parts[3])) != nil
    else { return nil }
    if parts.count == 4, parts[2] == "images" { return "api/images/\(parts[3])" }
    if parts.count == 6, parts[2] == "notes", parts[4] == "media", let index = Int(parts[5]) {
      return "api/notes/\(parts[3])/media/\(index)"
    }
    return nil
  }

  private static func successful(_ data: Data, response: URLResponse) throws -> HTTPURLResponse {
    guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    guard (200..<300).contains(response.statusCode) else {
      let message = String(decoding: data.prefix(1_000), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
      throw refusal(message.isEmpty ? "Stash refused the image (HTTP \(response.statusCode))." : message,
        status: response.statusCode)
    }
    return response
  }

  private static func refusal(_ message: String, status: Int) -> NSError {
    NSError(domain: "Stash", code: status, userInfo: [NSLocalizedDescriptionKey: message])
  }
}

private final class StashPhotoSessionDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}

private actor PendingShares {
  private var settling = false

  // No answer means iOS may still be sending. Once it answers, keep only shares the app can send again.
  func settle() async throws -> [String] {
    guard !settling else { return [] }
    settling = true
    defer { settling = false }

    let store = try ShareStore(app: .main)
    let manager = FileManager.default
    guard manager.fileExists(atPath: store.folder.path) else { return [] }
    let now = Date()
    let bodies = try manager.contentsOfDirectory(at: store.folder, includingPropertiesForKeys: [.contentModificationDateKey])
    var rejections: [String] = []
    for body in bodies {
      let outcome = ShareAnswer.file(for: body)
      guard let route = route(for: body) else { continue }
      let recorded = try? JSONDecoder().decode(ShareAnswer.self, from: Data(contentsOf: outcome))
      let answer: ShareAnswer
      if let recorded, recorded.accepted || recorded.final {
        answer = recorded
      } else {
        let queued = (try? body.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? now
        if recorded == nil, now.timeIntervalSince(queued) < 86_400 { continue }
        guard let (data, response) = try? await URLSession.shared.upload(
          for: store.request(route.path, type: route.type), fromFile: body)
        else { continue }
        answer = ShareAnswer(data: data, response: response)
      }
      if answer.final {
        let message = answer.message.trimmingCharacters(in: .whitespacesAndNewlines)
        rejections.append(message.isEmpty ? "Stash refused a share." : message)
      }
      if answer.accepted || answer.final {
        try? manager.removeItem(at: body)
        try? manager.removeItem(at: outcome)
      }
    }
    return rejections
  }

  private func route(for body: URL) -> (path: String, type: String)? {
    let id = body.deletingPathExtension().lastPathComponent
    guard UUID(uuidString: id) != nil else { return nil }
    switch body.pathExtension {
    case "json": return ("api/capture", "application/json")
    case "jpg": return ("api/files/\(id)", "image/jpeg")
    case "mp4": return ("api/files/\(id)", "video/mp4")
    case "mov": return ("api/files/\(id)", "video/quicktime")
    default: return nil
    }
  }
}
