import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

public final class CoverViewProps: UIBaseViewProps {
  @Field var url: String = ""
}

public struct CoverView: ExpoSwiftUI.View {
  @ObservedObject public var props: CoverViewProps
  @State private var image: UIImage?
  @State private var failed = false

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
      .overlay {
        if image == nil && failed {
          SwiftUI.Image(systemName: "arrow.clockwise").foregroundStyle(.secondary)
        }
      }
      .clipped()
      .task(id: props.url) {
        let link = props.url
        failed = false
        image = CoverCache.memory.object(forKey: link as NSString)
        if image != nil { return }
        guard let url = URL(string: link) else { return }
        var failures = 0.0
        while !Task.isCancelled {
          if let loaded = await PageLoader.image(url, size: 240) {
            // Kept even when the row scrolled away, so the next time it shows at once.
            CoverCache.memory.setObject(
              loaded, forKey: link as NSString, cost: loaded.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
            if !Task.isCancelled { image = loaded }
            return
          }
          failures += 1
          failed = true
          try? await Task.sleep(for: .seconds(min(pow(2, failures), 8)))
          failed = false
        }
      }
  }
}

// Thumbnails stay in memory up to their decoded bytes; PageLoader already keeps the source image on disk.
@MainActor
enum CoverCache {
  static let memory: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.totalCostLimit = 48 << 20
    return cache
  }()
}
