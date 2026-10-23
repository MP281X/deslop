import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

// The pictures in assets/, which the podspec ships as the OpmNative bundle.
enum Assets {
  private static let bundle =
    Bundle.main.url(forResource: "OpmNative", withExtension: "bundle").flatMap(Bundle.init(url:)) ?? .main

  static func image(_ name: String) -> UIImage {
    UIImage(named: name, in: bundle, with: nil) ?? UIImage()
  }
}

public final class TitleViewProps: UIBaseViewProps {}

// The app icon beside the series name in the lettering of the cover, tinted like text so it follows the appearance.
public struct TitleView: ExpoSwiftUI.View {
  @ObservedObject public var props: TitleViewProps

  public init(props: TitleViewProps) {
    self.props = props
  }

  public var body: some View {
    HStack(spacing: 10) {
      SwiftUI.Image(uiImage: Assets.image("icon"))
        .resizable()
        .frame(width: 34, height: 34)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      SwiftUI.Image(uiImage: Assets.image("logo"))
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
        .frame(height: 28)
        .foregroundStyle(.primary)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("One-Punch Man")
    .accessibilityAddTraits(.isHeader)
  }
}

public final class ChapterProgressViewProps: UIBaseViewProps {
  // Read pages over all pages; 1 once the chapter is read.
  @Field var fraction: Double = 0
  // The theme's colors, so the disc follows it in either appearance.
  @Field var accent: Color = .orange
  @Field var read: Color = .primary
}

// A gray disc that fills with the accent as pages are read and turns the read color once the chapter is read.
public struct ChapterProgressView: ExpoSwiftUI.View {
  @ObservedObject public var props: ChapterProgressViewProps

  public init(props: ChapterProgressViewProps) {
    self.props = props
  }

  public var body: some View {
    let fraction = min(max(props.fraction, 0), 1)
    ZStack {
      Circle().fill(fraction >= 1 ? props.read : Color(uiColor: .systemGray4))
      if fraction > 0 && fraction < 1 {
        Wedge(fraction: fraction).fill(props.accent)
      }
    }
    .animation(.easeOut(duration: 0.25), value: fraction)
    .accessibilityElement()
    .accessibilityLabel(fraction >= 1 ? "Read" : fraction > 0 ? "\(Int(fraction * 100))% read" : "Unread")
  }
}

struct Wedge: Shape {
  var fraction: Double

  var animatableData: Double {
    get { fraction }
    set { fraction = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let center = CGPoint(x: rect.midX, y: rect.midY)
    var path = Path()
    path.move(to: center)
    path.addArc(
      center: center, radius: min(rect.width, rect.height) / 2, startAngle: .degrees(-90),
      endAngle: .degrees(-90 + 360 * fraction), clockwise: false)
    path.closeSubpath()
    return path
  }
}
