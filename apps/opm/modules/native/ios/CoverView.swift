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
        image = CoverCache.shared.object(forKey: link as NSString)
        guard image == nil, let url = URL(string: link), let loaded = await PageLoader.image(url, size: 180)
        else { return }
        CoverCache.shared.setObject(loaded, forKey: link as NSString)
        // A new link cancels this task, and the image it decoded belongs to the old one.
        if !Task.isCancelled { image = loaded }
      }
  }
}

// Decoded thumbnails, so scrolling the list back up shows them without decoding again.
@MainActor
enum CoverCache {
  static let shared = NSCache<NSString, UIImage>()
}
