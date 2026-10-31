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

// DESIGN.md's colors for Stash, as packages/components-mobile/src/theme.ts has them, in system fonts.
private enum Theme {
  static let app = Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
  static let background = color(dark: 0x0a0a0a, light: 0xffffff)
  static let foreground = color(dark: 0xededed, light: 0x0a0a0a)
  static let muted = color(dark: 0x9a9a9a, light: 0x666666)
  static let primary = color(dark: 0xd0a215, light: 0xad8301)
  static let destructive = color(dark: 0xd14d41, light: 0xaf3029)
  static let logo = app?.url(forResource: "assets/src/routes/icon", withExtension: "png").flatMap {
    UIImage(contentsOfFile: $0.path)
  }

  private static func color(dark: Int, light: Int) -> Color {
    Color(
      uiColor: UIColor { traits in
        let value = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((value >> 16) & 0xff) / 255, green: CGFloat((value >> 8) & 0xff) / 255,
          blue: CGFloat(value & 0xff) / 255, alpha: 1)
      })
  }
}

// The tick draws itself in where iOS can draw symbols, from iOS 26.
private struct DrawsOn: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.transition(.symbolEffect(.drawOn))
    } else {
      content
    }
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
          ProgressView().controlSize(.large).tint(Theme.primary).frame(height: 44)
          Text("Saving…").font(.headline).foregroundStyle(Theme.foreground)
        case .saved:
          Image(systemName: "checkmark").font(.system(size: 36, weight: .semibold)).foregroundStyle(Theme.primary)
            .frame(height: 44).modifier(DrawsOn())
          Text("Saved").font(.headline).foregroundStyle(Theme.foreground)
        case .queued:
          Image(systemName: "arrow.up").font(.system(size: 36, weight: .semibold)).foregroundStyle(Theme.primary)
            .frame(height: 44).symbolEffect(.bounce, value: phase)
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
    .animation(.snappy, value: phase)
    // One haptic as the outcome lands, on the same frame as its symbol.
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
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.\(identifier)")
    else {
      throw CocoaError(.featureUnsupported)
    }
    guard let server = URL(string: "https://stash.mp281x.xyz") else {
      throw CocoaError(.featureUnsupported)
    }
    self.server = server
    self.keychainGroup = keychainGroup
    self.group = "group.\(identifier)"
    self.folder = container.appendingPathComponent("uploads", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let stale = Date().addingTimeInterval(-86_400)
    let files = try FileManager.default.contentsOfDirectory(
      at: folder, includingPropertiesForKeys: [.contentModificationDateKey])
    for file in files {
      let modified = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
      if let modified, modified < stale { try? FileManager.default.removeItem(at: file) }
    }
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
    if let status = try? await sendNow(payload, to: path, type: type) {
      if (200..<300).contains(status) { return .saved }
      if (400..<500).contains(status) { throw rejection(status) }
    }
    let body = file(named: name)
    try payload.write(to: body, options: .atomic)
    try await send(body, to: path, type: type, id: id)
    return .queued
  }

  private func rejection(_ status: Int) -> NSError {
    let message: String
    switch status {
    case 401, 403: message = "Open Stash and sign in again."
    case 413: message = "This is too large for Stash."
    default: message = "Stash refused this share (HTTP \(status))."
    }
    return NSError(domain: "Stash", code: status, userInfo: [NSLocalizedDescriptionKey: message])
  }

  private func sendNow(_ payload: Data, to path: String, type: String) async throws -> Int {
    var request = URLRequest(url: server.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue(type, forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(try await accessToken(validFor: 60))", forHTTPHeaderField: "Authorization")
    let (_, response) = try await URLSession.shared.upload(for: request, from: payload)
    guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return response.statusCode
  }

  func send(_ body: URL, to path: String, type: String, id: String) async throws {
    var request = URLRequest(url: server.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue(type, forHTTPHeaderField: "Content-Type")
    // A queued background request cannot replace its bearer after the extension closes, so it needs a day of validity.
    request.setValue("Bearer \(try await accessToken(validFor: 86_460))", forHTTPHeaderField: "Authorization")
    let configuration = URLSessionConfiguration.background(withIdentifier: "\(group).share.\(id)")
    configuration.sharedContainerIdentifier = group
    configuration.isDiscretionary = false
    configuration.timeoutIntervalForResource = 86_400
    let session = URLSession(configuration: configuration)
    session.uploadTask(with: request, fromFile: body).resume()
    session.finishTasksAndInvalidate()
  }

  private var keychainQuery: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "deslop.auth", kSecAttrAccount as String: "stash",
      kSecAttrAccessGroup as String: keychainGroup]
  }

  private func accessToken(validFor seconds: Double) async throws -> String {
    let descriptor = try await SessionLock.acquire(group: group)
    defer { SessionLock.release(descriptor) }
    var query = keychainQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &value)
    guard status == errSecSuccess, let data = value as? Data else {
      throw NSError(domain: "Stash", code: 401, userInfo: [NSLocalizedDescriptionKey: "Open Stash and sign in first."])
    }
    var credentials = try JSONDecoder().decode(Credentials.self, from: data)
    if credentials.expiresAt > (Date().timeIntervalSince1970 + seconds) * 1000 { return credentials.accessToken }
    var form = URLComponents()
    form.queryItems = [URLQueryItem(name: "client_id", value: credentials.clientId),
      URLQueryItem(name: "grant_type", value: "refresh_token"),
      URLQueryItem(name: "refresh_token", value: credentials.refreshToken),
      URLQueryItem(name: "resource", value: "https://stash.mp281x.xyz"),
      URLQueryItem(name: "resource", value: "https://otel.mp281x.xyz")]
    guard let endpoint = URL(string: "https://auth.mp281x.xyz/api/auth/oauth2/token") else {
      throw CocoaError(.featureUnsupported)
    }
    var request = URLRequest(url: endpoint)
    request.timeoutInterval = 10
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
    let (body, response) = try await URLSession.shared.data(for: request)
    guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
      throw NSError(domain: "Stash", code: 401, userInfo: [NSLocalizedDescriptionKey: "Open Stash and sign in again."])
    }
    let token = try JSONDecoder().decode(OAuthResponse.self, from: body)
    credentials.accessToken = token.access_token
    credentials.refreshToken = token.refresh_token
    credentials.expiresAt = Date().timeIntervalSince1970 * 1000 + token.expires_in * 1000
    let saved = SecItemUpdate(keychainQuery as CFDictionary,
      [kSecValueData as String: try JSONEncoder().encode(credentials)] as CFDictionary)
    guard saved == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(saved)) }
    return credentials.accessToken
  }
}

private struct Credentials: Codable {
  var accessToken: String
  let clientId: String
  var expiresAt: Double
  var refreshToken: String
}

private struct OAuthResponse: Decodable {
  let access_token: String
  let expires_in: Double
  let refresh_token: String
}

private enum SharedText {
  // TikTok and X share a link, Safari a link and its title, other apps plain text.
  static func read(from context: NSExtensionContext) async -> (text: String, hasLink: Bool) {
    var texts: [String] = []
    var links: [String] = []
    for provider in providers(of: context) {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
        let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) as? URL,
        !url.isFileURL
      {
        links.append(url.absoluteString)
      }
      if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
        let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) as? String
      {
        texts.append(text)
      }
    }
    let body = texts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    let extra = links.filter { link in !body.contains { $0.contains(link) } }
    return ((body + extra).joined(separator: "\n"), !links.isEmpty)
  }
}

private enum SharedFile {
  // A video goes as it is, because the server reads MP4 and QuickTime; a photo goes as a JPEG.
  static func send(from context: NSExtensionContext, with upload: Upload) async throws -> Outcome? {
    let items = providers(of: context)
    let id = UUID().uuidString.lowercased()
    if let provider = items.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
      let mp4 = provider.hasItemConformingToTypeIdentifier(UTType.mpeg4Movie.identifier)
      let target = upload.file(named: "\(id).\(mp4 ? "mp4" : "mov")")
      // The system deletes the loaded file when the handler returns, so the copy happens inside it.
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        _ = provider.loadFileRepresentation(
          forTypeIdentifier: mp4 ? UTType.mpeg4Movie.identifier : UTType.movie.identifier
        ) { url, error in
          guard let url else {
            continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
            return
          }
          continuation.resume(with: Result(catching: { try FileManager.default.copyItem(at: url, to: target) }))
        }
      }
      // A video can take minutes to upload, longer than the sheet stays open.
      try await upload.send(target, to: "api/files/\(id)", type: mp4 ? "video/mp4" : "video/quicktime", id: id)
      return .queued
    }
    if let provider = items.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) {
      let item = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil)
      guard let jpeg = jpeg(from: item) else {
        throw CocoaError(.fileReadCorruptFile)
      }
      return try await upload.deliver(jpeg, named: "\(id).jpg", to: "api/files/\(id)", type: "image/jpeg", id: id)
    }
    return nil
  }

  // A full-size photo decoded at once can pass the extension's memory limit, so it is downsampled while decoding.
  private static func jpeg(from item: NSSecureCoding) -> Data? {
    if let image = item as? UIImage { return image.jpegData(compressionQuality: 0.85) }
    let source: CGImageSource?
    if let data = item as? Data {
      source = CGImageSourceCreateWithData(data as CFData, nil)
    } else if let url = item as? URL {
      source = CGImageSourceCreateWithURL(url as CFURL, nil)
    } else {
      source = nil
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 4096,
    ]
    guard let source, let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      return nil
    }
    return UIImage(cgImage: image).jpegData(compressionQuality: 0.85)
  }
}

private func providers(of context: NSExtensionContext) -> [NSItemProvider] {
  context.inputItems.compactMap { $0 as? NSExtensionItem }.flatMap { $0.attachments ?? [] }
}
