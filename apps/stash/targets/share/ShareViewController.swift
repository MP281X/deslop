import ImageIO
import Security
import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    guard let context = extensionContext else { return }
    view.backgroundColor = .clear
    let host = UIHostingController(rootView: SaveView(context: context))
    host.view.backgroundColor = .clear
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addChild(host)
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }
}

private enum Phase: Equatable {
  case saving
  case saved
  case queued
  case failed(String)
}

// Saved means the server accepted the note; queued means the background session will send it after the sheet closes.
private enum Outcome {
  case saved
  case queued
}

// Stash's colors as the app's Info.plist carries them from packages/components-mobile/src/palette.ts, in system fonts.
private enum Theme {
  static let app = Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
  static let background = color("background")
  static let foreground = color("foreground")
  static let muted = color("muted")
  static let primary = color("primary")
  static let destructive = color("destructive")
  static let logo = app?.url(forResource: "assets/src/routes/icon", withExtension: "png").flatMap {
    UIImage(contentsOfFile: $0.path)
  }

  private static func color(_ name: String) -> Color {
    guard let palette = app?.object(forInfoDictionaryKey: "DeslopTheme") as? [String: [String: String]] else {
      fatalError("The app's Info.plist has no DeslopTheme")
    }
    return Color(
      uiColor: UIColor { traits in
        let hex = palette[name]?[traits.userInterfaceStyle == .dark ? "dark" : "light"]
        guard let hex, let value = Int(hex.dropFirst(), radix: 16) else { fatalError("DeslopTheme has no \(name)") }
        return UIColor(
          red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
          blue: CGFloat(value & 0xff) / 255, alpha: 1)
      })
  }
}

private struct SaveView: View {
  let context: NSExtensionContext
  @State private var phase = Phase.saving

  init(context: NSExtensionContext) {
    self.context = context
  }

  // iOS always presents the extension as a full-height sheet, ignoring overFullScreen and custom detents,
  // so the status fills the sheet's center, under the app's name as its own screens show it.
  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        if let logo = Theme.logo {
          Image(uiImage: logo).resizable().interpolation(.none).frame(width: 18, height: 18)
        }
        Text("stash").font(.headline).foregroundStyle(Theme.foreground)
      }
      .padding(.top, 20)
      VStack(spacing: 12) {
        switch phase {
        case .saving:
          Image(systemName: "tray.and.arrow.down").font(.system(size: 36, weight: .semibold))
            .foregroundStyle(Theme.muted).frame(height: 44)
          Text("Saving…").font(.headline).foregroundStyle(Theme.foreground)
        case .saved:
          Image(systemName: "checkmark").font(.system(size: 36, weight: .semibold)).foregroundStyle(Theme.primary)
            .frame(height: 44)
          Text("Saved").font(.headline).foregroundStyle(Theme.foreground)
        case .queued:
          Image(systemName: "arrow.up").font(.system(size: 36, weight: .semibold)).foregroundStyle(Theme.primary)
            .frame(height: 44)
          Text("Sending…").font(.headline).foregroundStyle(Theme.foreground)
          Text("It shows up once the upload finishes.").font(.footnote).foregroundStyle(Theme.muted)
        case .failed(let message):
          Image(systemName: "exclamationmark.triangle").font(.system(size: 34, weight: .semibold))
            .foregroundStyle(Theme.destructive).frame(height: 44)
          Text("Not saved").font(.headline).foregroundStyle(Theme.foreground)
          Text(message).font(.footnote).foregroundStyle(Theme.muted)
          Text("Tap to close").font(.caption).foregroundStyle(Theme.muted).padding(.top, 8)
        }
      }
      .multilineTextAlignment(.center)
      .padding(.horizontal, 32)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(Theme.background)
    .contentShape(Rectangle())
    .sensoryFeedback(trigger: phase) { _, next in
      switch next {
      case .saved: .success
      case .failed: .error
      default: nil
      }
    }
    .onTapGesture { if case .failed = phase { context.completeRequest(returningItems: nil) } }
    .task { await save() }
  }

  private func save() async {
    do {
      let upload = try Upload()
      let shared = await SharedText.read(from: context)
      // A shared web page keeps its link even when it also offers an image.
      if !shared.hasLink, let outcome = try await SharedFile.send(from: context, with: upload) {
        await finish(outcome)
        return
      }
      if shared.text.isEmpty {
        phase = .failed("Share a link, text, a photo or a video.")
        return
      }
      // The server accepts at most 20,000 UTF-16 units, as JavaScript counts them.
      if shared.text.utf16.count > 20_000 {
        phase = .failed("A note holds at most 20,000 characters.")
        return
      }
      await finish(try await upload.text(shared.text))
    } catch {
      phase = .failed(error.localizedDescription)
    }
  }

  private func finish(_ outcome: Outcome) async {
    switch outcome {
    case .saved:
      phase = .saved
      try? await Task.sleep(for: .milliseconds(700))
    case .queued:
      phase = .queued
      try? await Task.sleep(for: .milliseconds(1_400))
    }
    context.completeRequest(returningItems: nil)
  }
}

// A background session sends the body after the sheet closes, and it uploads only from a file in the App Group.
private struct Upload {
  let server: URL
  let group: String
  let folder: URL
  let keychainGroup: String

  init() throws {
    // The extension runs from the app's PlugIns/ folder, so the containing app's bundle is two levels up.
    let app = Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
    guard
      let app,
      let identifier = app.bundleIdentifier,
      let keychainGroup = app.object(forInfoDictionaryKey: "DeslopKeychainGroup") as? String,
      let address = app.object(forInfoDictionaryKey: "DeslopServer") as? String,
      let server = URL(string: address),
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.\(identifier)")
    else {
      throw CocoaError(.featureUnsupported)
    }
    self.server = server
    self.keychainGroup = keychainGroup
    self.group = "group.\(identifier)"
    // Stash reads the server's answer beside each queued body and removes both once it has handled it.
    self.folder = container.appendingPathComponent("uploads", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }

  func file(named name: String) -> URL {
    folder.appendingPathComponent(name)
  }

  func text(_ text: String) async throws -> Outcome {
    let id = UUID().uuidString.lowercased()
    let payload = try JSONEncoder().encode(["id": id, "text": text])
    return try await deliver(payload, named: "\(id).json", to: "api/capture", type: "application/json", id: id)
  }

  // Sent while the sheet is open, the note exists before the app opens. Offline, a timeout or a server error
  // queues it on the background session, and the server keys each save by its id, so a resend is not a duplicate.
  func deliver(_ payload: Data, named name: String, to path: String, type: String, id: String) async throws -> Outcome {
    if let answer = try? await sendNow(payload, to: path, type: type) {
      if (200..<300).contains(answer.status) { return .saved }
      if (400..<500).contains(answer.status) { throw rejection(answer.status, answer.message) }
    }
    let body = file(named: name)
    try payload.write(to: body, options: .atomic)
    try await send(body, to: path, type: type, id: id)
    return .queued
  }

  // The server says why it refused a share it can never take, such as an empty text or an oversized file.
  private func rejection(_ status: Int, _ answer: String) -> NSError {
    let message: String
    switch status {
    case 401: message = "Open Stash and sign in, then share again."
    case 403: message = "This account cannot use Stash."
    case 413: message = answer.isEmpty ? "This is too large for Stash." : answer
    default: message = answer.isEmpty ? "Stash refused this share (HTTP \(status))." : answer
    }
    return NSError(domain: "Stash", code: status, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private func sendNow(_ payload: Data, to path: String, type: String) async throws -> (status: Int, message: String) {
    var request = URLRequest(url: server.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue(type, forHTTPHeaderField: "Content-Type")
    authorize(&request)
    let (body, response) = try await URLSession.shared.upload(for: request, from: payload)
    guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return (response.statusCode, String(decoding: body.prefix(1_000), as: UTF8.self))
  }

  // The task carries the body's name, so whichever process hears the answer, this sheet or Stash after it closed, records it beside the body.
  func send(_ body: URL, to path: String, type: String, id: String) async throws {
    var request = URLRequest(url: server.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue(type, forHTTPHeaderField: "Content-Type")
    // The cookie is copied now and must still be valid when iOS sends the body; Stash sends it again if the server refuses it.
    authorize(&request)
    let configuration = URLSessionConfiguration.background(withIdentifier: "\(group).share.\(id)")
    configuration.sharedContainerIdentifier = group
    configuration.isDiscretionary = false
    configuration.timeoutIntervalForResource = 86_400
    let session = URLSession(configuration: configuration, delegate: UploadRecorder(folder: folder), delegateQueue: nil)
    let task = session.uploadTask(with: request, fromFile: body)
    task.taskDescription = body.lastPathComponent
    task.resume()
    session.finishTasksAndInvalidate()
  }

  // Auth names the caller from the session cookie the app saved in the Keychain; a device on the tailnet has none and needs none.
  private func authorize(_ request: inout URLRequest) {
    request.httpShouldHandleCookies = false
    if let secret = secret() {
      request.setValue("__Secure-deslop-session=\(secret)", forHTTPHeaderField: "Cookie")
    }
  }

  private func secret() -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app:no-auth", kSecAttrGeneric as String: Data("session".utf8),
      kSecAttrAccount as String: Data("session".utf8), kSecAttrAccessGroup as String: keychainGroup,
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
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

// The server's answer to a queued body, written as `<body>.outcome` in the App Group for Stash to act on: status 0 when no answer came.
// Stash's StashNative module records the answers that arrive after this sheet closed in the same form.
private final class UploadRecorder: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let folder: URL
  private let lock = NSLock()
  private var answers: [Int: Data] = [:]

  init(folder: URL) {
    self.folder = folder
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.withLock { answers[dataTask.taskIdentifier, default: Data()].append(data.prefix(1_000)) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let answer = lock.withLock { answers.removeValue(forKey: task.taskIdentifier) } ?? Data()
    guard let name = task.taskDescription else { return }
    let status = error == nil ? (task.response as? HTTPURLResponse)?.statusCode ?? 0 : 0
    let outcome: [String: Any] = ["message": String(decoding: answer.prefix(1_000), as: UTF8.self), "status": status]
    if let data = try? JSONSerialization.data(withJSONObject: outcome) {
      try? data.write(to: folder.appendingPathComponent("\(name).outcome"), options: .atomic)
    }
  }
}

// A provider that never answers would keep the sheet saying "Saving…", so each load is cancelled after 20 seconds,
// which ends it with an error; a load that ignores the cancellation still answers only once.
private func loaded<T: Sendable>(_ start: (@escaping @Sendable (T?, Error?) -> Void) -> Progress) async throws -> T {
  try await withCheckedThrowingContinuation { continuation in
    let once = Once(continuation)
    let progress = start { value, error in
      if let value {
        once.resume(returning: value)
      } else {
        once.resume(throwing: error ?? CocoaError(.fileReadUnknown))
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { progress.cancel() }
  }
}

private final class Once<T: Sendable>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, Error>?

  init(_ continuation: CheckedContinuation<T, Error>) {
    self.continuation = continuation
  }

  func resume(returning value: T) {
    lock.withLock { continuation.take() }?.resume(returning: value)
  }

  func resume(throwing error: Error) {
    lock.withLock { continuation.take() }?.resume(throwing: error)
  }
}

private enum SharedText {
  // TikTok and X share a link, Safari a link and its title or a selection, other apps plain text.
  static func read(from context: NSExtensionContext) async -> (text: String, hasLink: Bool) {
    var texts: [String] = []
    var links: [String] = []
    for provider in providers(of: context) {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
        let url: URL = try? await loaded({ done in provider.loadObject(ofClass: URL.self) { url, error in done(url, error) } }),
        !url.isFileURL
      {
        links.append(url.absoluteString)
      }
      if let text = await registeredText(from: provider) {
        texts.append(text)
      }
    }
    // Safari hands a selection over as one plain-text attachment with the same text in the item, so the item is read only without one.
    if texts.isEmpty, links.isEmpty {
      texts = context.inputItems.compactMap { ($0 as? NSExtensionItem)?.attributedContentText?.string }
    }
    let body = texts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    let extra = links.filter { link in !body.contains { $0.contains(link) } }
    return ((body + extra).joined(separator: "\n"), !links.isEmpty)
  }

  // loadObject(ofClass: String.self) accepts only UTF-8 text, so the item is loaded by the type the provider registered,
  // as a string, an attributed string or encoded bytes. loadItem has no Progress, so the cancellation is this one's.
  private static func registeredText(from provider: NSItemProvider) async -> String? {
    guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .plainText) == true })
    else { return nil }
    return try? await loaded { done in
      let progress = Progress(totalUnitCount: 1)
      progress.cancellationHandler = { done(nil, CocoaError(.userCancelled)) }
      provider.loadItem(forTypeIdentifier: type, options: nil) { item, error in
        let text: String?
        switch item {
        case let string as String: text = string
        case let string as NSAttributedString: text = string.string
        case let bytes as Data: text = String(data: bytes, encoding: .utf8) ?? String(data: bytes, encoding: .utf16)
        default: text = nil
        }
        done(text, error)
      }
      return progress
    }
  }
}

private enum SharedFile {
  // The server takes at most 1 GiB; a larger video is refused before it is copied.
  static let maxVideoBytes = 1 << 30

  // A video goes as it is, because the server reads MP4 and QuickTime; a photo goes as a JPEG.
  static func send(from context: NSExtensionContext, with upload: Upload) async throws -> Outcome? {
    let items = providers(of: context)
    let id = UUID().uuidString.lowercased()
    if let provider = items.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
      let mp4 = provider.hasItemConformingToTypeIdentifier(UTType.mpeg4Movie.identifier)
      let target = upload.file(named: "\(id).\(mp4 ? "mp4" : "mov")")
      // The system deletes the loaded file when the handler returns, so the size check and the copy happen inside it.
      let _: Bool = try await loaded { done in
        provider.loadFileRepresentation(forTypeIdentifier: mp4 ? UTType.mpeg4Movie.identifier : UTType.movie.identifier) {
          url, error in
          guard let url else { return done(nil, error) }
          do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            if size > maxVideoBytes {
              return done(
                nil,
                NSError(
                  domain: "Stash", code: 413,
                  userInfo: [NSLocalizedDescriptionKey: "Stash takes videos up to 1 GB."]))
            }
            try FileManager.default.copyItem(at: url, to: target)
            done(true, nil)
          } catch {
            done(nil, error)
          }
        }
      }
      // A video can take minutes to upload, longer than the sheet stays open.
      try await upload.send(target, to: "api/files/\(id)", type: mp4 ? "video/mp4" : "video/quicktime", id: id)
      return .queued
    }
    if let provider = items.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) {
      guard let jpeg = try await jpeg(from: provider) else {
        throw CocoaError(.fileReadCorruptFile)
      }
      return try await upload.deliver(jpeg, named: "\(id).jpg", to: "api/files/\(id)", type: "image/jpeg", id: id)
    }
    return nil
  }

  // A full-size photo decoded at once can pass the extension's memory limit, so every photo is downsampled to 4096
  // pixels: from its file while decoding, or, for a provider that offers only an image object, by drawing it smaller.
  private static func jpeg(from provider: NSItemProvider) async throws -> Data? {
    let type =
      provider.registeredTypeIdentifiers.first { UTType($0)?.conforms(to: .image) == true } ?? UTType.image.identifier
    let fromFile: Data? = try? await loaded { done in
      provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
        let options: [CFString: Any] = [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 4096,
        ]
        guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return done(nil, error) }
        done(UIImage(cgImage: image).jpegData(compressionQuality: 0.85), nil)
      }
    }
    if let fromFile { return fromFile }
    guard provider.canLoadObject(ofClass: UIImage.self) else { return nil }
    let image: UIImage = try await loaded { done in
      provider.loadObject(ofClass: UIImage.self) { image, error in done(image as? UIImage, error) }
    }
    let scale = min(1, 4096 / max(image.size.width, image.size.height, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.85) { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
  }
}

private func providers(of context: NSExtensionContext) -> [NSItemProvider] {
  context.inputItems.compactMap { $0 as? NSExtensionItem }.flatMap { $0.attachments ?? [] }
}
