import ExpoModulesCore
import ExpoUI
import ImageIO
import SwiftUI
import UIKit

struct StripChapter: Record, Equatable {
  @Field var number: Double = 0
  @Field var pages: [String] = []

  static func == (left: StripChapter, right: StripChapter) -> Bool {
    left.number == right.number && left.pages == right.pages
  }
}

public final class PageStripViewProps: UIBaseViewProps {
  @Field var chapters: [StripChapter] = []
  @Field var start: Int = 0
  var onPage = EventDispatcher()
}

// The pages of one or more chapters in one vertical strip: pinch or double-tap to zoom, tap to show the bars, scroll to hide them.
public struct PageStripView: ExpoSwiftUI.View {
  @ObservedObject public var props: PageStripViewProps
  @State private var barsHidden = true

  public init(props: PageStripViewProps) {
    self.props = props
  }

  public var body: some View {
    PageStrip(
      chapters: props.chapters,
      start: props.start,
      onPage: { index in props.onPage(["index": index]) },
      onTap: { withAnimation(.easeInOut(duration: 0.2)) { barsHidden.toggle() } },
      onScroll: {
        if !barsHidden { withAnimation(.easeInOut(duration: 0.2)) { barsHidden = true } }
      }
    )
    .ignoresSafeArea()
    .background(Color.black)
    .toolbar(barsHidden ? .hidden : .visible, for: .navigationBar)
    .statusBarHidden(barsHidden)
    .persistentSystemOverlays(barsHidden ? .hidden : .automatic)
  }
}

struct PageStrip: UIViewRepresentable {
  let chapters: [StripChapter]
  let start: Int
  let onPage: (Int) -> Void
  let onTap: () -> Void
  let onScroll: () -> Void

  func makeCoordinator() -> StripController {
    StripController()
  }

  func makeUIView(context: Context) -> UIScrollView {
    update(context.coordinator)
    return context.coordinator.scrollView
  }

  func updateUIView(_ view: UIScrollView, context: Context) {
    update(context.coordinator)
  }

  private func update(_ controller: StripController) {
    controller.onPage = onPage
    controller.onTap = onTap
    controller.onScroll = onScroll
    controller.show(chapters: chapters, start: start)
  }
}

final class StripScrollView: UIScrollView {
  var onLayout: () -> Void = {}

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout()
  }
}

final class StripController: NSObject, UIScrollViewDelegate {
  // Black shows through between pages, as a thin line where one ends.
  private static let gap: CGFloat = 1
  private static let markerHeight: CGFloat = 64

  let scrollView = StripScrollView()
  private let content = UIView()
  private var chapters: [StripChapter] = []
  private var pageViews: [PageView] = []
  private var markers: [EndMarker] = []
  // Height over width of each page; a page keeps a typical manga shape until its image arrives.
  private var aspects: [CGFloat] = []
  private var pendingStart: Int?
  private var current = -1
  private var laidOutWidth: CGFloat = 0
  var onPage: (Int) -> Void = { _ in }
  var onTap: () -> Void = {}
  var onScroll: () -> Void = {}

  override init() {
    super.init()
    scrollView.delegate = self
    scrollView.backgroundColor = .black
    // The strip is black in either appearance, so its markers take the dark one's colors.
    scrollView.overrideUserInterfaceStyle = .dark
    scrollView.minimumZoomScale = 1
    scrollView.maximumZoomScale = 4
    scrollView.contentInsetAdjustmentBehavior = .never
    scrollView.addSubview(content)
    scrollView.onLayout = { [weak self] in self?.fit() }
    let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
    double.numberOfTapsRequired = 2
    let single = UITapGestureRecognizer(target: self, action: #selector(tapped))
    single.require(toFail: double)
    scrollView.addGestureRecognizer(double)
    scrollView.addGestureRecognizer(single)
  }

  // The same chapters with more after them extend the strip in place; anything else starts over at `start`.
  func show(chapters: [StripChapter], start: Int) {
    if chapters == self.chapters { return }
    if !self.chapters.isEmpty && chapters.count > self.chapters.count
      && Array(chapters.prefix(self.chapters.count)) == self.chapters
    {
      chapters[self.chapters.count...].forEach(add)
      self.chapters = chapters
      layout()
      return
    }
    content.subviews.forEach { $0.removeFromSuperview() }
    pageViews = []
    markers = []
    aspects = []
    self.chapters = chapters
    current = -1
    chapters.forEach(add)
    scrollView.zoomScale = 1
    pendingStart = min(max(start, 0), max(pageViews.count - 1, 0))
    layout()
  }

  private func add(_ chapter: StripChapter) {
    for url in chapter.pages {
      let index = pageViews.count
      let view = PageView(url: url)
      view.onAspect = { [weak self] aspect in self?.resize(index, to: aspect) }
      content.addSubview(view)
      pageViews.append(view)
      aspects.append(1.42)
    }
    let marker = EndMarker(number: chapter.number)
    content.addSubview(marker)
    markers.append(marker)
  }

  // The window's safe area, not the view's, so the strip starts below the Dynamic Island whether or not the bars show.
  private func fit() {
    let insets = scrollView.window?.safeAreaInsets ?? .zero
    let inset = UIEdgeInsets(top: insets.top, left: 0, bottom: insets.bottom, right: 0)
    if scrollView.contentInset != inset {
      scrollView.contentInset = inset
      layout()
    } else if scrollView.bounds.width != laidOutWidth {
      layout()
    }
  }

  private func layout() {
    let width = scrollView.bounds.width
    guard width > 0 else { return }
    laidOutWidth = width
    let scale = scrollView.zoomScale
    var y: CGFloat = 0
    var page = 0
    for (index, chapter) in chapters.enumerated() {
      for _ in chapter.pages {
        let height = (width * aspects[page]).rounded()
        pageViews[page].frame = CGRect(x: 0, y: y, width: width, height: height)
        y += height + Self.gap
        page += 1
      }
      markers[index].frame = CGRect(x: 0, y: y, width: width, height: Self.markerHeight)
      y += Self.markerHeight
    }
    content.bounds = CGRect(x: 0, y: 0, width: width, height: y)
    content.center = CGPoint(x: width * scale / 2, y: y * scale / 2)
    scrollView.contentSize = CGSize(width: width * scale, height: y * scale)
    // The start waits for the window, whose safe area sets the inset it scrolls past.
    if let start = pendingStart, start < pageViews.count, scrollView.window != nil {
      pendingStart = nil
      let top = scrollView.contentInset.top
      let limit = max(scrollView.contentSize.height - scrollView.bounds.height + scrollView.contentInset.bottom, -top)
      scrollView.contentOffset = CGPoint(x: 0, y: min(pageViews[start].frame.minY * scale - top, limit))
    }
    track()
  }

  // A page above the screen that grows or shrinks moves the offset with it, so what is on screen stays put.
  private func resize(_ index: Int, to aspect: CGFloat) {
    guard index < aspects.count, abs(aspects[index] - aspect) > 0.001 else { return }
    let scale = scrollView.zoomScale
    let above = pageViews[index].frame.maxY <= (scrollView.contentOffset.y + scrollView.contentInset.top) / scale
    let delta = (laidOutWidth * aspect).rounded() - (laidOutWidth * aspects[index]).rounded()
    aspects[index] = aspect
    layout()
    if above {
      scrollView.contentOffset.y += delta * scale
    }
  }

  // The page under the middle of the screen is the one being read; only pages near it hold their images.
  private func track() {
    guard !pageViews.isEmpty else { return }
    let scale = scrollView.zoomScale
    let middle = (scrollView.contentOffset.y + scrollView.bounds.height / 2) / scale
    let index = pageViews.firstIndex { $0.frame.maxY > middle } ?? pageViews.count - 1
    for (position, view) in pageViews.enumerated() {
      if position >= index - 2 && position <= index + 4 {
        view.load()
      } else if position < index - 6 || position > index + 8 {
        view.unload()
      }
    }
    if index != current {
      current = index
      onPage(index)
    }
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    track()
    if scrollView.isDragging { onScroll() }
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? {
    content
  }

  @objc private func tapped() {
    onTap()
  }

  @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
    if scrollView.zoomScale > 1.01 {
      scrollView.setZoomScale(1, animated: true)
      return
    }
    let point = gesture.location(in: content)
    let size = CGSize(width: scrollView.bounds.width / 2.5, height: scrollView.bounds.height / 2.5)
    scrollView.zoom(
      to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height),
      animated: true)
  }
}

// "End of 242" between two hairlines, after the last page of each chapter.
final class EndMarker: UIView {
  private let label = UILabel()
  private let left = UIView()
  private let right = UIView()

  init(number: Double) {
    super.init(frame: .zero)
    label.text = "End of \(number.rounded() == number ? String(Int(number)) : String(number))"
    label.font = .systemFont(ofSize: 13)
    label.textColor = .secondaryLabel
    left.backgroundColor = .separator
    right.backgroundColor = .separator
    [left, label, right].forEach(addSubview)
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    label.sizeToFit()
    label.center = CGPoint(x: bounds.midX, y: bounds.midY)
    let line = 1 / max(traitCollection.displayScale, 1)
    left.frame = CGRect(x: 20, y: bounds.midY, width: max(label.frame.minX - 32, 0), height: line)
    right.frame = CGRect(
      x: label.frame.maxX + 12, y: bounds.midY, width: max(bounds.width - label.frame.maxX - 32, 0), height: line)
  }
}

final class PageView: UIImageView {
  private let url: URL?
  private let spinner = UIActivityIndicatorView(style: .medium)
  private var task: Task<Void, Never>?
  var onAspect: (CGFloat) -> Void = { _ in }

  init(url: String) {
    self.url = URL(string: url)
    super.init(frame: .zero)
    contentMode = .scaleAspectFit
    spinner.color = .gray
    spinner.startAnimating()
    addSubview(spinner)
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
  }

  func load() {
    guard image == nil, task == nil, let url else { return }
    task = Task { [weak self] in
      let loaded = await PageLoader.image(url, size: 3000)
      guard let self, !Task.isCancelled else { return }
      self.task = nil
      guard let loaded, loaded.size.width > 0 else { return }
      self.image = loaded
      self.spinner.stopAnimating()
      self.onAspect(loaded.size.height / loaded.size.width)
    }
  }

  func unload() {
    task?.cancel()
    task = nil
    guard image != nil else { return }
    image = nil
    spinner.startAnimating()
  }
}

enum PageLoader {
  // Pages never change at their link, so a read chapter opens again from the disk without the network.
  static let session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.urlCache = URLCache(
      memoryCapacity: 16 << 20, diskCapacity: 1 << 30,
      directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent("pages"))
    configuration.requestCachePolicy = .returnCacheDataElseLoad
    return URLSession(configuration: configuration)
  }()

  // `size` is the longest side in pixels: a zoomed-in screen for a page, a few points for a cover.
  static func image(_ url: URL, size: Int) async -> UIImage? {
    guard let (data, _) = try? await session.data(from: url) else { return nil }
    return await Task.detached(priority: .userInitiated) { decode(data, size: size) }.value
  }

  // Decoding off the main thread, and no larger than needed, keeps scrolling smooth and memory flat.
  private static func decode(_ data: Data, size: Int) -> UIImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
    else { return nil }
    let options =
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceThumbnailMaxPixelSize: size,
      ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
    return UIImage(cgImage: image)
  }
}
