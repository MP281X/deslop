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

  private func save() async {
    do {
      let (data, type) = try await SharedTicket.read(from: context)
      guard let address = Theme.app?.object(forInfoDictionaryKey: "DeslopServer") as? String,
        let server = URL(string: address)
      else { throw CocoaError(.featureUnsupported) }
      var request = URLRequest(url: server.appendingPathComponent("share"))
      request.httpMethod = "POST"
      request.httpShouldHandleCookies = false
      request.timeoutInterval = 240
      request.setValue(type, forHTTPHeaderField: "Content-Type")
      let (body, response) = try await URLSession.shared.upload(for: request, from: data)
      guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
      guard (200..<300).contains(response.statusCode) else {
        throw NSError(domain: "Trips", code: response.statusCode,
          userInfo: [NSLocalizedDescriptionKey: String(decoding: body, as: UTF8.self)])
      }
      phase = .added
      try? await Task.sleep(for: .milliseconds(700))
      context.completeRequest(returningItems: nil)
    } catch {
      phase = .failed(error.localizedDescription)
    }
  }
}

private enum SharedTicket {
  static func read(from context: NSExtensionContext) async throws -> (Data, String) {
    let providers = context.inputItems.compactMap { $0 as? NSExtensionItem }.flatMap { $0.attachments ?? [] }
    for (identifier, type) in [("com.apple.pkpass", "application/vnd.apple.pkpass"),
      (UTType.pdf.identifier, "application/pdf")]
    {
      if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(identifier) }) {
        return (try await file(provider, identifier), type)
      }
    }
    if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) {
      let item = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil)
      guard let data = jpeg(from: item) else { throw CocoaError(.fileReadCorruptFile) }
      return (data, "image/jpeg")
    }
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
    return (Data(text.utf8), "text/plain; charset=utf-8")
  }

  private static func file(_ provider: NSItemProvider, _ identifier: String) async throws -> Data {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
      _ = provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
        guard let url else {
          continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
          return
        }
        // The temporary URL is valid only while this handler runs.
        continuation.resume(with: Result(catching: { try Data(contentsOf: url) }))
      }
    }
  }

  private static func jpeg(from item: NSSecureCoding) -> Data? {
    if let image = item as? UIImage { return image.jpegData(compressionQuality: 0.85) }
    let source: CGImageSource?
    if let data = item as? Data {
      source = CGImageSourceCreateWithData(data as CFData, nil)
    } else if let url = item as? URL {
      source = CGImageSourceCreateWithURL(url as CFURL, nil)
    } else { source = nil }
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
