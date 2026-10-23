import ExpoModulesCore
import ExpoUI
import SwiftUI

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
