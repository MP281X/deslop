import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

public final class CoverViewProps: UIBaseViewProps {
  @Field var url: String = ""
}

// A chapter's first page as a thumbnail, a gray tile with a spinner until it loads; the caller sizes and rounds it.
// A failed cover shows a retry mark and tries again after two, four, then every eight seconds while its row is on screen.
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
        if image == nil {
          if failed {
            SwiftUI.Image(systemName: "arrow.clockwise").foregroundStyle(.secondary)
          } else {
            ProgressView().controlSize(.small)
          }
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
            CoverCache.memory.setObject(loaded, forKey: link as NSString)
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

// Thumbnails stay in memory; PageLoader already keeps the source image on disk.
@MainActor
enum CoverCache {
  static let memory: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.countLimit = 400
    return cache
  }()
}
