import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

public class DeslopComponentsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeslopComponents")

    // Metadata only: iOS asks for paste permission when the user chooses to read the content.
    Function("clipboardChangeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    // The copied image as a JPEG file, so its bytes never cross into JavaScript as base64: its size, and the file only when it fits in `maxBytes`; nil when the pasteboard holds no image.
    AsyncFunction("clipboardImage") { (maxBytes: Int) throws -> [String: Any]? in
      guard let image = UIPasteboard.general.image, let jpeg = image.jpegData(compressionQuality: 0.85) else {
        return nil
      }
      if jpeg.count > maxBytes {
        return ["bytes": jpeg.count]
      }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).jpg")
      try jpeg.write(to: url, options: .atomic)
      return ["bytes": jpeg.count, "uri": url.absoluteString]
    }

    // Foundation writes beside the file and renames over it, which replaces it in one step; expo-file-system's overwriting move deletes the old file first.
    Function("writeAtomically") { (url: URL, text: String) throws in
      try Data(text.utf8).write(to: url, options: .atomic)
    }

    // Never unregistered: after an update reload the old module is destroyed after the new one registered, and would remove it.
    OnCreate {
      ViewModifierRegistry.register("bottomBarSearch") { params, appContext, _ in
        try BottomBarSearch(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register("barNeverMinimizes") { params, appContext, _ in
        try BarNeverMinimizes(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register("stackedColumns") { params, appContext, _ in
        try StackedColumns(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register("listColumn") { params, appContext, _ in
        try ListColumn(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register("searchFocused") { params, appContext, eventDispatcher in
        try SearchFocused(from: params, appContext: appContext, eventDispatcher: eventDispatcher)
      }
      ViewModifierRegistry.register("seeThrough") { params, appContext, _ in
        try SeeThrough(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register("backHidden") { params, appContext, _ in
        try BackHidden(from: params, appContext: appContext)
      }
      ViewModifierRegistry.register("sidebarToggleHidden") { params, appContext, _ in
        try SidebarToggleHidden(from: params, appContext: appContext)
      }
    }
  }
}

// The search field between the bottom bar's buttons, where iOS 26 would otherwise fold it into a button of its own. On the unfolded iPhone Duo, iOS 27 reserves 24 points above the home indicator for the bar, half its 48-point glass, so a list's last row ends behind the bar; with the keyboard up iOS reserves only the keyboard, while the field rides 8 points above it, all its glass over the content. The content's safe area grows to the glass, unless the bar stands beside the content, as in a landscape window.
struct BottomBarSearch: ViewModifier, Record {
  @State private var shortfall: CGFloat = 0

  func body(content: Content) -> some View {
    content
      .safeAreaPadding(.bottom, shortfall)
      .onGeometryChange(for: CGFloat.self, of: { $0.safeAreaInsets.bottom }) { bottom in
        guard let window = UIApplication.shared.connectedScenes.lazy.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else {
          return
        }
        let reserved = bottom - window.safeAreaInsets.bottom
        shortfall = switch reserved {
        case ...0: 0
        case ...48: 48 - reserved
        // More than the glass is the keyboard's.
        default: 48 + 8
        }
      }
      .toolbar {
        ToolbarSpacer(.fixed, placement: .bottomBar)
        DefaultToolbarItem(kind: .search, placement: .bottomBar)
        ToolbarSpacer(.fixed, placement: .bottomBar)
      }
  }
}

// Whether the field of the `searchable` before it has focus, and so the keyboard, both ways: Expo UI's `searchable` reports only the text. Setting `focused` false ends the focus and keeps the query.
struct SearchFocused: ViewModifier, Record {
  @Field var focused: Bool = false
  var eventDispatcher: EventDispatcher?
  @FocusState private var focus: Bool

  init() {}

  init(from params: Dict, appContext: AppContext, eventDispatcher: EventDispatcher) throws {
    try self = .init(from: params, appContext: appContext)
    self.eventDispatcher = eventDispatcher
  }

  func body(content: Content) -> some View {
    content
      .searchFocused($focus)
      .onChange(of: focus) { _, focus in
        eventDispatcher?(["searchFocused": ["focused": focus]])
      }
      .onChange(of: focused) { _, focused in
        focus = focused
      }
  }
}

// Invisible and out of reach, to touch and to VoiceOver, while staying mounted, so what lies under it shows and answers. Always applied, so the view keeps its state when `through` changes.
struct SeeThrough: ViewModifier, Record {
  @Field var through: Bool = false

  func body(content: Content) -> some View {
    content
      .opacity(through ? 0 : 1)
      .allowsHitTesting(!through)
      .accessibilityHidden(through)
  }
}

// iOS calls the unfolded iPhone Duo regular in either orientation, so a split view tiles its columns half open like a laptop too, where the item stands above the list instead; a compact width stacks them as on the outer screen. Always applied, so a split view keeps its state when `stacked` changes.
struct StackedColumns: ViewModifier, Record {
  @Field var stacked: Bool = false

  func body(content: Content) -> some View {
    content.transformEnvironment(\.horizontalSizeClass) { sizeClass in
      if stacked {
        sizeClass = .compact
      }
    }
  }
}

// iOS 27 minimizes the navigation bar while content scrolls down. A screen with nothing to scroll, such as a draft that replaces a note read halfway, would keep the bar minimized, title and buttons gone, with no scroll to bring it back. Always applied, so the screen keeps its state, such as a reading place, when `never` changes.
struct BarNeverMinimizes: ViewModifier, Record {
  @Field var never: Bool = true

  func body(content: Content) -> some View {
    if #available(iOS 27.0, *) {
      content.toolbarMinimizationBehavior(never ? .never : .automatic, for: .navigationBar)
    } else {
      content
    }
  }
}

// A pushed screen with nowhere to go back to, such as a board that stands above the list a Back would return to.
struct BackHidden: ViewModifier, Record {
  func body(content: Content) -> some View {
    content.navigationBarBackButtonHidden(true)
  }
}

// A split view's sidebar button, removed while nothing could stand beside the list it would hide. Always applied, so the list keeps its state when `hidden` changes.
struct SidebarToggleHidden: ViewModifier, Record {
  @Field var hidden: Bool = false

  func body(content: Content) -> some View {
    content.toolbar(removing: hidden ? .sidebarToggle : nil)
  }
}

// The list's column, `width` points beside the item, on the split view it is applied to. SwiftUI takes a column's width only from the column's own root view, which Expo UI wraps; an iPad's limits keep the list at 320 points, and its minimum for the item leaves an upright window too narrow to tile, so the list would float over the item. The split view first lays out before any view can reach it, and floating the list there reports it hidden, so it stays compact, its columns stacked, until it is set. Always applied, so the split view keeps its state when `width` changes.
struct ListColumn: ViewModifier, Record {
  @Field var width: Double = 320

  func body(content: Content) -> some View {
    content.modifier(SplitColumnSet(width: CGFloat(width)))
  }
}

struct SplitColumnSet: ViewModifier {
  let width: CGFloat
  @State private var configured = false

  func body(content: Content) -> some View {
    content
      .transformEnvironment(\.horizontalSizeClass) { sizeClass in
        if !configured {
          sizeClass = .compact
        }
      }
      .background(SplitColumn(width: width, onConfigured: { configured = true }).accessibilityHidden(true))
  }
}

struct SplitColumn: UIViewRepresentable {
  let width: CGFloat
  let onConfigured: () -> Void

  func makeUIView(context: Context) -> SplitColumnView {
    SplitColumnView()
  }

  func updateUIView(_ view: SplitColumnView, context: Context) {
    view.width = width
    view.onConfigured = onConfigured
    view.apply()
  }
}

// Sets the split view beside it, and again each time SwiftUI puts back its own column widths, which it does whenever it updates the split view.
final class SplitColumnView: UIView {
  // The narrowest item beside the list, a folded phone's width.
  private static let item: CGFloat = 320
  var width: CGFloat = 320
  var onConfigured: () -> Void = {}
  private weak var split: UISplitViewController?
  private var observations: [NSKeyValueObservation] = []
  private var applying = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    attach()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if split == nil { attach() }
  }

  // The nearest split view under its ancestors, the one whose view answers to it, which SwiftUI may add after this.
  private func attach() {
    let found = sequence(first: self as UIView, next: { $0.superview }).lazy.compactMap(Self.split(in:)).first
    if found !== split {
      split = found
      observations = found.map { split in
        [
          split.observe(\.preferredPrimaryColumnWidth) { [weak self] _, _ in self?.apply() },
          split.observe(\.minimumPrimaryColumnWidth) { [weak self] _, _ in self?.apply() },
          split.observe(\.maximumPrimaryColumnWidth) { [weak self] _, _ in self?.apply() },
          split.observe(\.minimumSecondaryColumnWidth) { [weak self] _, _ in self?.apply() },
          split.observe(\.preferredSplitBehavior) { [weak self] _, _ in self?.apply() }
        ]
      } ?? []
    }
    apply()
    // After this update, since SwiftUI's state may not change during one.
    if split != nil {
      DispatchQueue.main.async { [onConfigured] in onConfigured() }
    }
  }

  private static func split(in view: UIView) -> UISplitViewController? {
    (view.next as? UISplitViewController) ?? view.subviews.lazy.compactMap(split(in:)).first
  }

  func apply() {
    guard let split, !applying else { return }
    let sized = [split.minimumPrimaryColumnWidth, split.maximumPrimaryColumnWidth, split.preferredPrimaryColumnWidth] == [width, width, width]
    guard split.preferredSplitBehavior != .tile || !sized || split.minimumSecondaryColumnWidth != Self.item else { return }
    applying = true
    defer { applying = false }
    split.preferredSplitBehavior = .tile
    split.minimumSecondaryColumnWidth = Self.item
    split.minimumPrimaryColumnWidth = width
    split.maximumPrimaryColumnWidth = width
    split.preferredPrimaryColumnWidth = width
    // The split view decides again whether its columns fit side by side only when asked for a display mode.
    let mode = split.preferredDisplayMode
    split.preferredDisplayMode = mode
  }
}
