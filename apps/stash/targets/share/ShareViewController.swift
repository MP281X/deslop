import SwiftUI
import UIKit
import UniformTypeIdentifiers

// The share sheet loads this controller. It saves what was shared at once and closes itself,
// so sharing from TikTok, X or Safari takes one tap and never leaves that app.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    guard let context = extensionContext else { return }
    let host = UIHostingController(rootView: SaveView(context: context))
    addChild(host)
    host.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.topAnchor.constraint(equalTo: view.topAnchor),
      host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    host.didMove(toParent: self)
  }
}

private enum Phase: Equatable {
  case saving
  case sent
  case kept
  case nothing
  case failed(String)
}

// The deslop shadcn theme, as the app uses it: zinc, an orange accent and JetBrains Mono.
private enum Theme {
  static func color(light: UInt32, dark: UInt32) -> Color {
    Color(
      uiColor: UIColor { traits in
        let value = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(
          red: CGFloat((value >> 16) & 0xFF) / 255,
          green: CGFloat((value >> 8) & 0xFF) / 255,
          blue: CGFloat(value & 0xFF) / 255,
          alpha: 1
        )
      })
  }

  static let background = color(light: 0xFFFFFF, dark: 0x111114)
  static let foreground = color(light: 0x09090B, dark: 0xF3F3F5)
  static let muted = color(light: 0x71717B, dark: 0xADADB5)
  static let primary = color(light: 0xF54900, dark: 0xE78A53)

  static func mono(_ size: CGFloat, semibold: Bool = false) -> Font {
    .custom(semibold ? "JetBrainsMono-SemiBold" : "JetBrainsMono-Regular", size: size)
  }
}

private struct SaveView: View {
  let context: NSExtensionContext
  @State private var phase = Phase.saving

  var body: some View {
    VStack(spacing: 10) {
      switch phase {
      case .saving:
        ProgressView().tint(Theme.primary)
      case .sent:
        Image(systemName: "checkmark")
          .font(.system(size: 36, weight: .semibold))
          .foregroundStyle(Theme.primary)
          .symbolEffect(.bounce, value: phase)
        Text("saved to stash").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
      case .kept:
        Text("saved on this iphone").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
        Text("stash sends it when the server is reachable over tailscale")
          .font(Theme.mono(13))
          .foregroundStyle(Theme.muted)
          .multilineTextAlignment(.center)
      case .nothing:
        Text("nothing to save").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
        Text("share a link or some text").font(Theme.mono(13)).foregroundStyle(Theme.muted)
      case .failed(let message):
        Text("not saved").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
        Text(message)
          .font(Theme.mono(13))
          .foregroundStyle(Theme.muted)
          .multilineTextAlignment(.center)
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.background)
    // A tap anywhere closes the sheet once the save has an outcome, so there is no button.
    .contentShape(Rectangle())
    .onTapGesture {
      if phase != .saving { context.completeRequest(returningItems: nil) }
    }
    .sensoryFeedback(trigger: phase) { _, phase in
      switch phase {
      case .sent: .success
      case .kept: .warning
      case .nothing, .failed: .error
      case .saving: nil
      }
    }
    .task { await save() }
  }

  private func save() async {
    let text = await SharedText.read(from: context)
    if text.isEmpty {
      phase = .nothing
      return
    }
    // The server and the app's outbox accept at most 20,000 UTF-16 units, as JavaScript counts them.
    if text.utf16.count > 20_000 {
      phase = .failed("too long: a note holds at most 20,000 characters")
      return
    }
    do {
      let store = try Store()
      let capture = Capture(id: UUID().uuidString.lowercased(), text: text, createdAt: Date().timeIntervalSince1970 * 1000)
      // The pending file is written first, so the capture survives a failed request or a killed extension.
      let file = try store.keep(capture)
      if await store.send(capture) {
        try? FileManager.default.removeItem(at: file)
        phase = .sent
        try? await Task.sleep(for: .milliseconds(700))
        context.completeRequest(returningItems: nil)
      } else {
        phase = .kept
      }
    } catch {
      phase = .failed(error.localizedDescription)
    }
  }
}

// The same shape as a pending capture in the app: the app sends what the extension could not.
private struct Capture: Codable {
  let id: String
  let text: String
  let createdAt: Double
}

private struct Store {
  let server: URL
  let pending: URL

  init() throws {
    // The extension runs from the app's PlugIns/ folder, so the containing app's bundle is two levels up.
    let app = Bundle(url: Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent())
    guard
      let app,
      let identifier = app.bundleIdentifier,
      let address = app.object(forInfoDictionaryKey: "StashServer") as? String,
      let server = URL(string: address),
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.\(identifier)")
    else {
      throw CocoaError(.featureUnsupported)
    }
    self.server = server
    self.pending = container.appendingPathComponent("pending", isDirectory: true)
  }

  func keep(_ capture: Capture) throws -> URL {
    try FileManager.default.createDirectory(at: pending, withIntermediateDirectories: true)
    let file = pending.appendingPathComponent("\(capture.id).json")
    try JSONEncoder().encode(capture).write(to: file, options: .atomic)
    return file
  }

  func send(_ capture: Capture) async -> Bool {
    var request = URLRequest(url: server.appendingPathComponent("api/capture"), timeoutInterval: 8)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONEncoder().encode(["id": capture.id, "text": capture.text])
    guard let result = try? await URLSession.shared.data(for: request),
      let response = result.1 as? HTTPURLResponse
    else { return false }
    return (200..<300).contains(response.statusCode)
  }
}

private enum SharedText {
  // TikTok and X share a link, Safari a link and its title, other apps plain text.
  // The result keeps every shared text and adds each link that the text does not already contain.
  static func read(from context: NSExtensionContext) async -> String {
    let providers = context.inputItems
      .compactMap { $0 as? NSExtensionItem }
      .flatMap { $0.attachments ?? [] }
    var texts: [String] = []
    var links: [String] = []
    // One attachment can offer both a link and text, so each representation is read on its own.
    for provider in providers {
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
    return (body + extra).joined(separator: "\n")
  }
}
