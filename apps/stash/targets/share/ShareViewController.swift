import SwiftUI
import UIKit
import UniformTypeIdentifiers

// The share sheet loads this controller. It saves what was shared at once and closes itself,
// so sharing a link, some text, a photo or a video takes one tap and never leaves that app.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    guard let context = extensionContext else { return }
    // A clear page shows only the small card, so the app the user shared from stays in view behind it.
    view.backgroundColor = .clear
    let host = UIHostingController(rootView: SaveView(context: context))
    host.view.backgroundColor = .clear
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
  static let border = color(light: 0xE4E4E7, dark: 0x2E2E33)

  static func mono(_ size: CGFloat, semibold: Bool = false) -> Font {
    .custom(semibold ? "JetBrainsMono-SemiBold" : "JetBrainsMono-Regular", size: size)
  }
}

private struct SaveView: View {
  let context: NSExtensionContext
  @State private var phase = Phase.saving

  var body: some View {
    VStack(spacing: 8) {
      switch phase {
      case .saving:
        ProgressView().tint(Theme.primary)
      case .sent:
        Image(systemName: "checkmark")
          .font(.system(size: 24, weight: .semibold))
          .foregroundStyle(Theme.primary)
          .symbolEffect(.bounce, value: phase)
        Text("saved to stash").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
      case .nothing:
        Text("nothing to save").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
        Text("share a link, text, a photo or a video").font(Theme.mono(13)).foregroundStyle(Theme.muted)
      case .failed(let message):
        Text("not saved").font(Theme.mono(16, semibold: true)).foregroundStyle(Theme.foreground)
        Text(message)
          .font(Theme.mono(13))
          .foregroundStyle(Theme.muted)
          .multilineTextAlignment(.center)
      }
    }
    .padding(20)
    .frame(maxWidth: 320)
    .background(Theme.background)
    .overlay(Rectangle().stroke(Theme.border, lineWidth: 1))
    .padding(.bottom, 48)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    // A tap anywhere closes the sheet once the save has an outcome, so there is no button.
    .contentShape(Rectangle())
    .onTapGesture {
      if phase != .saving { context.completeRequest(returningItems: nil) }
    }
    .sensoryFeedback(trigger: phase) { _, phase in
      switch phase {
      case .sent: .success
      case .nothing, .failed: .error
      case .saving: nil
      }
    }
    .task { await save() }
  }

  private func save() async {
    let shared = await SharedText.read(from: context)
    do {
      let store = try Store()
      let id = UUID().uuidString.lowercased()
      // A shared web page keeps its link even when it also offers an image; anything else with a photo or a video
      // saves the file.
      var file: PendingFile? = nil
      if !shared.hasLink { file = try await SharedFile.copy(from: context, into: store.pending, id: id) }
      if file == nil && shared.text.isEmpty {
        phase = .nothing
        return
      }
      // The server and the app's outbox accept at most 20,000 UTF-16 units, as JavaScript counts them.
      if file == nil && shared.text.utf16.count > 20_000 {
        phase = .failed("too long: a note holds at most 20,000 characters")
        return
      }
      let capture = Capture(
        id: id, text: file == nil ? shared.text : "", createdAt: Date().timeIntervalSince1970 * 1000, file: file)
      // The pending file is written first, so the capture survives a failed upload or a killed extension; the app
      // resends it on its next start, and the server answers a resent id with the note it already has.
      try store.keep(capture)
      // The upload runs in the system's background session, so the sheet closes without waiting for the server.
      try store.upload(capture)
      phase = .sent
      try? await Task.sleep(for: .milliseconds(250))
      context.completeRequest(returningItems: nil)
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
  // A photo or video saved next to the capture in pending/, named by the capture's id.
  let file: PendingFile?
}

private struct PendingFile: Codable {
  let name: String
  let type: String
}

private struct Store {
  let server: URL
  let group: String
  let pending: URL
  let uploads: URL

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
    self.group = "group.\(identifier)"
    self.pending = container.appendingPathComponent("pending", isDirectory: true)
    self.uploads = container.appendingPathComponent("uploads", isDirectory: true)
  }

  func keep(_ capture: Capture) throws {
    try FileManager.default.createDirectory(at: pending, withIntermediateDirectories: true)
    let file = pending.appendingPathComponent("\(capture.id).json")
    try JSONEncoder().encode(capture).write(to: file, options: .atomic)
  }

  // A background session uploads only from a file, so the request body lives in uploads/ until the next share
  // removes bodies older than a day. A photo or video is linked there, not copied, because the app deletes the pending
  // file once the server has it.
  func upload(_ capture: Capture) throws {
    let manager = FileManager.default
    try manager.createDirectory(at: uploads, withIntermediateDirectories: true)
    let stale = Date().addingTimeInterval(-86_400)
    for file in (try? manager.contentsOfDirectory(at: uploads, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
      let modified = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
      if let modified, modified < stale { try? manager.removeItem(at: file) }
    }
    var request: URLRequest
    let body: URL
    if let file = capture.file {
      body = uploads.appendingPathComponent(file.name)
      try? manager.removeItem(at: body)
      try manager.linkItem(at: pending.appendingPathComponent(file.name), to: body)
      request = URLRequest(url: server.appendingPathComponent("api/files/\(capture.id)"))
      request.setValue(file.type, forHTTPHeaderField: "Content-Type")
    } else {
      body = uploads.appendingPathComponent("\(capture.id).json")
      try JSONEncoder().encode(["id": capture.id, "text": capture.text]).write(to: body, options: .atomic)
      request = URLRequest(url: server.appendingPathComponent("api/capture"))
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    request.httpMethod = "POST"
    let configuration = URLSessionConfiguration.background(withIdentifier: "\(group).share.\(capture.id)")
    configuration.sharedContainerIdentifier = group
    configuration.isDiscretionary = false
    let session = URLSession(configuration: configuration)
    session.uploadTask(with: request, fromFile: body).resume()
    session.finishTasksAndInvalidate()
  }
}

private enum SharedText {
  // TikTok and X share a link, Safari a link and its title, other apps plain text.
  // The result keeps every shared text and adds each link that the text does not already contain.
  static func read(from context: NSExtensionContext) async -> (text: String, hasLink: Bool) {
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
    return ((body + extra).joined(separator: "\n"), !links.isEmpty)
  }
}

private enum SharedFile {
  // Copies a shared video as it is, because the server reads MP4 and QuickTime, or a shared photo as a JPEG. Photos
  // arrive as a file, as data, or as an image object from the screenshot editor.
  static func copy(from context: NSExtensionContext, into folder: URL, id: String) async throws -> PendingFile? {
    let providers = context.inputItems
      .compactMap { $0 as? NSExtensionItem }
      .flatMap { $0.attachments ?? [] }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.movie.identifier) }) {
      let mp4 = provider.hasItemConformingToTypeIdentifier(UTType.mpeg4Movie.identifier)
      let file = PendingFile(name: "\(id).\(mp4 ? "mp4" : "mov")", type: mp4 ? "video/mp4" : "video/quicktime")
      let target = folder.appendingPathComponent(file.name)
      let identifier = mp4 ? UTType.mpeg4Movie.identifier : UTType.movie.identifier
      // The system deletes the loaded file when the handler returns, so the copy happens inside it.
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        _ = provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
          guard let url else {
            continuation.resume(throwing: error ?? CocoaError(.fileReadUnknown))
            return
          }
          do {
            try FileManager.default.copyItem(at: url, to: target)
            continuation.resume()
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
      return file
    }
    if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }) {
      let item = try await provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil)
      guard let jpeg = image(from: item)?.jpegData(compressionQuality: 0.85) else {
        throw CocoaError(.fileReadCorruptFile)
      }
      let file = PendingFile(name: "\(id).jpg", type: "image/jpeg")
      try jpeg.write(to: folder.appendingPathComponent(file.name), options: .atomic)
      return file
    }
    return nil
  }

  private static func image(from item: NSSecureCoding) -> UIImage? {
    if let image = item as? UIImage { return image }
    if let data = item as? Data { return UIImage(data: data) }
    if let url = item as? URL { return UIImage(contentsOfFile: url.path) }
    return nil
  }
}
