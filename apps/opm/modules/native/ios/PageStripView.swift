import ExpoModulesCore
import ExpoUI
import ImageIO
import SwiftUI
import UIKit

public final class PageStripViewProps: UIBaseViewProps {
  @Field var pages: [String] = []
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
      pages: props.pages,
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
  let pages: [String]
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
    controller.show(pages: pages, start: start)
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
  let scrollView = StripScrollView()
  private let content = UIView()
  private var pageViews: [PageView] = []
  private var urls: [String] = []
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
    scrollView.minimumZoomScale = 1
    scrollView.maximumZoomScale = 4
    scrollView.contentInsetAdjustmentBehavior = .never
    scrollView.addSubview(content)
    scrollView.onLayout = { [weak self] in
      guard let self, self.scrollView.bounds.width != self.laidOutWidth else { return }
      self.layout()
    }
    let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
    double.numberOfTapsRequired = 2
    let single = UITapGestureRecognizer(target: self, action: #selector(tapped))
    single.require(toFail: double)
    scrollView.addGestureRecognizer(double)
    scrollView.addGestureRecognizer(single)
  }

  // The same pages with more after them extend the strip in place; anything else starts over at `start`.
  func show(pages: [String], start: Int) {
    if pages == urls { return }
    if !urls.isEmpty && pages.count > urls.count && Array(pages.prefix(urls.count)) == urls {
      pages[urls.count...].forEach(add)
      urls = pages
      layout()
      return
    }
    pageViews.forEach { $0.removeFromSuperview() }
    pageViews = []
    aspects = []
    urls = pages
    current = -1
    pages.forEach(add)
    scrollView.zoomScale = 1
    pendingStart = min(max(start, 0), max(pages.count - 1, 0))
    layout()
  }

  private func add(_ url: String) {
    let index = pageViews.count
    let view = PageView(url: url)
    view.onAspect = { [weak self] aspect in self?.resize(index, to: aspect) }
    content.addSubview(view)
    pageViews.append(view)
    aspects.append(1.42)
  }

  private func layout() {
    let width = scrollView.bounds.width
    guard width > 0 else { return }
    laidOutWidth = width
    let scale = scrollView.zoomScale
    var y: CGFloat = 0
    for (index, view) in pageViews.enumerated() {
      let height = (width * aspects[index]).rounded()
      view.frame = CGRect(x: 0, y: y, width: width, height: height)
      y += height
    }
    content.bounds = CGRect(x: 0, y: 0, width: width, height: y)
    content.center = CGPoint(x: width * scale / 2, y: y * scale / 2)
    scrollView.contentSize = CGSize(width: width * scale, height: y * scale)
    if let start = pendingStart, start < pageViews.count {
      pendingStart = nil
      let limit = max(scrollView.contentSize.height - scrollView.bounds.height, 0)
      scrollView.contentOffset = CGPoint(x: 0, y: min(pageViews[start].frame.minY * scale, limit))
    }
    track()
  }

  // A page above the screen that grows or shrinks moves the offset with it, so what is on screen stays put.
  private func resize(_ index: Int, to aspect: CGFloat) {
    guard index < aspects.count, abs(aspects[index] - aspect) > 0.001 else { return }
    let scale = scrollView.zoomScale
    let above = pageViews[index].frame.maxY <= scrollView.contentOffset.y / scale
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
      let loaded = await PageLoader.image(url)
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

  static func image(_ url: URL) async -> UIImage? {
    guard let (data, _) = try? await session.data(from: url) else { return nil }
    return await Task.detached(priority: .userInitiated) { decode(data) }.value
  }

  // Decoding off the main thread, and no larger than a zoomed-in screen needs, keeps scrolling smooth and memory flat.
  private static func decode(_ data: Data) -> UIImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
    else { return nil }
    let options =
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true,
        kCGImageSourceThumbnailMaxPixelSize: 3000,
      ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
    return UIImage(cgImage: image)
  }
}
