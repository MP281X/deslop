import ExpoModulesCore
import ExpoUI
import SwiftDraw
import SwiftUI
import UIKit

public class DeslopComponentsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeslopComponents")

    // Metadata only: iOS asks for paste permission when the user chooses to read the content.
    Function("clipboardChangeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    // Never unregistered: after an update reload the old module is destroyed after the new one registered, and would remove it.
    OnCreate {
      ViewModifierRegistry.register("bottomBarSearch") { params, appContext, _ in
        try BottomBarSearch(from: params, appContext: appContext)
      }
    }

    ExpoUIView(Logo.self)
  }
}

// The search field between the bottom bar's buttons, where iOS 26 would otherwise fold it into a button of its own.
struct BottomBarSearch: ViewModifier, Record {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.toolbar {
        ToolbarSpacer(.fixed, placement: .bottomBar)
        DefaultToolbarItem(kind: .search, placement: .bottomBar)
        ToolbarSpacer(.fixed, placement: .bottomBar)
      }
    } else {
      content
    }
  }
}

public final class LogoProps: UIBaseViewProps {
  @Field var uri: String = ""
  @Field var size: Double = 18
  @Field var template: Bool = false
}

// SwiftUI images cannot read SVG, so the logo is rasterized once per file, size and style.
public struct Logo: ExpoSwiftUI.View {
  @ObservedObject public var props: LogoProps

  public init(props: LogoProps) {
    self.props = props
  }

  @ViewBuilder
  public var body: some View {
    if let image = rendered(uri: props.uri, size: props.size, template: props.template) {
      Image(uiImage: image)
    }
  }
}

private let cache = NSCache<NSString, UIImage>()

private func rendered(uri: String, size: Double, template: Bool) -> UIImage? {
  let key = "\(uri) \(size) \(template)" as NSString
  if let image = cache.object(forKey: key) { return image }
  guard let url = URL(string: uri), let svg = SVG(fileURL: url) else { return nil }
  let fit = CGFloat(size) / max(svg.size.width, svg.size.height)
  let image = svg.rasterize(size: CGSize(width: svg.size.width * fit, height: svg.size.height * fit), scale: 3)
  guard let result = template ? cutout(image)?.withRenderingMode(.alwaysTemplate) : image else { return nil }
  cache.setObject(result, forKey: key)
  return result
}

// Menus tint only the alpha, so white parts become holes and every other color keeps its antialiased edge.
private func cutout(_ image: UIImage) -> UIImage? {
  guard let source = image.cgImage else { return nil }
  let width = source.width
  let height = source.height
  var pixels = [UInt8](repeating: 0, count: width * height * 4)
  let output: CGImage? = pixels.withUnsafeMutableBytes { buffer in
    guard
      let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
    for index in stride(from: 0, to: buffer.count, by: 4) {
      let alpha = Double(buffer[index + 3])
      guard alpha > 0 else { continue }
      let luminance =
        (0.299 * Double(buffer[index]) + 0.587 * Double(buffer[index + 1]) + 0.114 * Double(buffer[index + 2])) / alpha
      buffer[index] = 0
      buffer[index + 1] = 0
      buffer[index + 2] = 0
      buffer[index + 3] = UInt8(alpha * min(1, max(0, (1 - luminance) * 10)))
    }
    return context.makeImage()
  }
  return output.map { UIImage(cgImage: $0, scale: image.scale, orientation: .up) }
}
