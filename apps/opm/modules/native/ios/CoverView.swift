import CryptoKit
import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

public final class CoverViewProps: UIBaseViewProps {
  @Field var url: String = ""
}

// A chapter's first page as a thumbnail, a gray tile until it loads; the caller sizes and rounds it.
public struct CoverView: ExpoSwiftUI.View {
  @ObservedObject public var props: CoverViewProps
  @State private var image: UIImage?

  public init(props: CoverViewProps) {
    self.props = props
  }

  public var body: some View {
    Color(uiColor: .tertiarySystemFill)
      .overlay(alignment: .top) {
        if let image {
          SwiftUI.Image(uiImage: image).resizable().scaledToFill()
        }
      }
      .clipped()
      .task(id: props.url) {
        let link = props.url
        image = CoverCache.memory.object(forKey: link as NSString)
        if image != nil { return }
        if let saved = await CoverCache.saved(link) {
          if !Task.isCancelled { image = saved }
          return
        }
        guard let url = URL(string: link), let loaded = await PageLoader.image(url, size: 240) else { return }
        // Kept even when the row scrolled away, so the next time it shows at once.
        CoverCache.save(loaded, for: link)
        if !Task.isCancelled { image = loaded }
      }
  }
}

// Thumbnails in memory for scrolling and on disk for the next launch: making one downloads a whole page.
@MainActor
enum CoverCache {
  static let memory: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.countLimit = 400
    return cache
  }()

  private static let folder: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
    .appendingPathComponent("covers")

  private static func file(_ link: String) -> URL? {
    let name = SHA256.hash(data: Data(link.utf8)).map { String(format: "%02x", $0) }.joined()
    return folder?.appendingPathComponent("\(name).jpg")
  }

  static func saved(_ link: String) async -> UIImage? {
    guard let file = file(link) else { return nil }
    let image = await Task.detached(priority: .userInitiated) {
      UIImage(contentsOfFile: file.path)?.preparingForDisplay()
    }.value
    if let image { memory.setObject(image, forKey: link as NSString) }
    return image
  }

  static func save(_ image: UIImage, for link: String) {
    memory.setObject(image, forKey: link as NSString)
    guard let folder, let file = file(link) else { return }
    Task.detached(priority: .utility) {
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try? image.jpegData(compressionQuality: 0.8)?.write(to: file, options: .atomic)
    }
  }
}
