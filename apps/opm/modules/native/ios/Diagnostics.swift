import Foundation
import MetricKit

// iOS hands over a report of each crash or hang on a later launch; it waits on disk until JavaScript forwards it.
final class Diagnostics: NSObject, MXMetricManagerSubscriber {
  static let shared = Diagnostics()

  private static let folder: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
    .appendingPathComponent("diagnostics")

  func start() {
    MXMetricManager.shared.add(self)
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    guard let folder = Self.folder else { return }
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    for payload in payloads {
      // Atomic, so a read never finds half a report.
      try? payload.jsonRepresentation().write(
        to: folder.appendingPathComponent("\(UUID().uuidString).json"), options: .atomic)
    }
  }

  // Each report once: reading it removes it.
  static func take() -> [String] {
    guard let folder, let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
    else { return [] }
    return files.filter { $0.pathExtension == "json" }.compactMap { file in
      defer { try? FileManager.default.removeItem(at: file) }
      return (try? Data(contentsOf: file)).flatMap { String(data: $0, encoding: .utf8) }
    }
  }
}
