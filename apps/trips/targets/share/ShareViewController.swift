import ImageIO
import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    guard let context = extensionContext else { return }
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
  case sending
  case added
  case failed(String)
}

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
    return Color(uiColor: UIColor { traits in
      let hex = palette[name]?[traits.userInterfaceStyle == .dark ? "dark" : "light"]
      guard let hex, let value = Int(hex.dropFirst(), radix: 16) else { fatalError("DeslopTheme has no \(name)") }
      return UIColor(red: CGFloat((value >> 16) & 0xff) / 255,
        green: CGFloat((value >> 8) & 0xff) / 255, blue: CGFloat(value & 0xff) / 255, alpha: 1)
    })
  }
}

private struct SaveView: View {
  let context: NSExtensionContext
  @State private var phase = Phase.sending

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 8) {
        if let logo = Theme.logo {
          Image(uiImage: logo).resizable().interpolation(.none).frame(width: 18, height: 18)
        }
        Text("trips").font(.headline).foregroundStyle(Theme.foreground)
      }
      .padding(.top, 20)
      VStack(spacing: 12) {
        switch phase {
        case .sending:
          Image(systemName: "tray.and.arrow.down").font(.system(size: 36, weight: .semibold))
            .foregroundStyle(Theme.muted).frame(height: 44)
          Text("Sending…").font(.headline).foregroundStyle(Theme.foreground)
        case .added:
          Image(systemName: "checkmark").font(.system(size: 36, weight: .semibold))
            .foregroundStyle(Theme.primary).frame(height: 44)
          Text("Added").font(.headline).foregroundStyle(Theme.foreground)
        case .failed(let message):
          Image(systemName: "exclamationmark.triangle").font(.system(size: 34, weight: .semibold))
            .foregroundStyle(Theme.destructive).frame(height: 44)
          Text(message).font(.footnote).foregroundStyle(Theme.foreground)
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
      case .added: .success
      case .failed: .error
      default: nil
      }
    }
    .onTapGesture { if case .failed = phase { context.completeRequest(returningItems: nil) } }
    .task { await save() }
  }

  // Trainline shares a journey with a change as one image per train; each is read, sent and released in order, so one
  // ticket is in memory at a time and the ones sent before a failure stay saved.
  private func save() async {
    var added = 0
    do {
      guard let address = Theme.app?.object(forInfoDictionaryKey: "DeslopServer") as? String,
        let server = URL(string: address)
      else { throw CocoaError(.featureUnsupported) }
      let tickets = SharedTicket.providers(in: context)
      if tickets.isEmpty {
        let text = try await SharedTicket.text(from: context)
        try await send(Data(text.utf8), "text/plain; charset=utf-8", to: server)
        added += 1
      }
      for provider in tickets {
        let (data, type) = try await SharedTicket.read(provider)
        try await send(data, type, to: server)
        added += 1
      }
      phase = .added
      try? await Task.sleep(for: .milliseconds(700))
      context.completeRequest(returningItems: nil)
    } catch {
      let saved = added > 0 ? "\(added) added before this failed. " : ""
      phase = .failed(saved + error.localizedDescription)
    }
  }

  private func send(_ data: Data, _ type: String, to server: URL) async throws {
    var request = URLRequest(url: server.appendingPathComponent("share"))
    request.httpMethod = "POST"
    request.timeoutInterval = 240
    request.setValue(type, forHTTPHeaderField: "Content-Type")
    authorize(&request)
    let (body, response) = try await URLSession.shared.upload(for: request, from: data)
    guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    guard (200..<300).contains(response.statusCode) else {
      let message = response.statusCode == 401
        ? "Open Trips and sign in, then share again."
        : String(decoding: body, as: UTF8.self)
      throw NSError(domain: "Trips", code: response.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
    }
  }

  // Auth names the caller from the session cookie the app saved in the Keychain; a device on the tailnet has none and needs none.
  private func authorize(_ request: inout URLRequest) {
    request.httpShouldHandleCookies = false
    guard let group = Theme.app?.object(forInfoDictionaryKey: "DeslopKeychainGroup") as? String else { return }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app:no-auth", kSecAttrGeneric as String: Data("session".utf8),
      kSecAttrAccount as String: Data("session".utf8), kSecAttrAccessGroup as String: group,
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var value: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data,
      let secret = String(data: data, encoding: .utf8), !secret.isEmpty
    else { return }
    request.setValue("__Secure-deslop-session=\(secret)", forHTTPHeaderField: "Cookie")
  }
}

private enum SharedTicket {
  // The server's limit for one ticket; a larger one is refused here before it is read into memory.
  static let maxBytes = 4_000_000

  static func tooLarge() -> NSError {
    NSError(domain: "Trips", code: 413, userInfo: [NSLocalizedDescriptionKey: "This ticket is larger than 4 MB."])
  }

  // Every attached pass, PDF or image is a ticket; text and links count only when nothing else was shared.
  static func providers(in context: NSExtensionContext) -> [NSItemProvider] {
    context.inputItems.compactMap { $0 as? NSExtensionItem }.flatMap { $0.attachments ?? [] }.filter {
      $0.hasItemConformingToTypeIdentifier("com.apple.pkpass")
        || $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier)
        || $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
    }
  }

  static func read(_ provider: NSItemProvider) async throws -> (Data, String) {
    if provider.hasItemConformingToTypeIdentifier("com.apple.pkpass") {
      return (try await file(provider, "com.apple.pkpass"), "application/vnd.apple.pkpass")
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
      return (try await file(provider, UTType.pdf.identifier), "application/pdf")
    }
    let item = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil)
    guard let data = jpeg(from: item) else { throw CocoaError(.fileReadCorruptFile) }
    return (data, "image/jpeg")
  }

  static func text(from context: NSExtensionContext) async throws -> String {
    let providers = context.inputItems.compactMap { $0 as? NSExtensionItem }.flatMap { $0.attachments ?? [] }
    var texts: [String] = []
    for provider in providers {
      if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
        let text = try await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) as? String
      { texts.append(text) }
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
        let url = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) as? URL,
        !url.isFileURL, !texts.contains(where: { $0.contains(url.absoluteString) })
      { texts.append(url.absoluteString) }
    }
    let text = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      throw NSError(domain: "Trips", code: 0,
        userInfo: [NSLocalizedDescriptionKey: "Share an image, PDF, Wallet pass, text or URL."])
    }
    return text
  }

  // The file's size is checked before its bytes are read, and closing the sheet cancels the provider's copy.
  private static func file(_ provider: NSItemProvider, _ identifier: String) async throws -> Data {
    let progress = Progress()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
        progress.addChild(
          provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
            guard let url else {
              continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
              return
            }
            // The temporary URL is valid only while this handler runs.
            continuation.resume(with: Result(catching: {
              let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
              guard size <= SharedTicket.maxBytes else { throw SharedTicket.tooLarge() }
              return try Data(contentsOf: url)
            }))
          }, withPendingUnitCount: 1)
      }
    } onCancel: {
      progress.cancel()
    }
  }

  // Every image, whatever the provider hands over, is drawn at most 4096 pixels on its long side, then smaller until
  // its JPEG fits the server's limit.
  private static func jpeg(from item: NSSecureCoding) -> Data? {
    let render: (CGFloat) -> UIImage?
    if let image = item as? UIImage {
      render = { side in
        let longest = max(image.size.width, image.size.height) * image.scale
        let factor = min(1, side / longest) * image.scale
        return image.preparingThumbnail(of: CGSize(width: image.size.width * factor, height: image.size.height * factor))
      }
    } else {
      let source: CGImageSource?
      if let data = item as? Data {
        source = CGImageSourceCreateWithData(data as CFData, nil)
      } else if let url = item as? URL {
        source = CGImageSourceCreateWithURL(url as CFURL, nil)
      } else { source = nil }
      guard let source else { return nil }
      render = { side in
        let options: [CFString: Any] = [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: side,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
      }
    }
    for side: CGFloat in [4096, 2048, 1024] {
      guard let data = render(side)?.jpegData(compressionQuality: 0.85) else { return nil }
      if data.count <= maxBytes { return data }
    }
    return nil
  }
}
