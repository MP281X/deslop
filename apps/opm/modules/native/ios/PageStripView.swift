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

// The pages of one or more chapters in one vertical strip: tap to show the bars, scroll to hide them, hold a page to copy it.
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
      barsHidden: barsHidden,
      onPage: { index in props.onPage(["index": index]) },
      onTap: { withAnimation(.easeInOut(duration: 0.2)) { barsHidden.toggle() } },
      onScroll: {
        if !barsHidden { withAnimation(.easeInOut(duration: 0.2)) { barsHidden = true } }
      }
    )
    .ignoresSafeArea()
    .background(Color.black)
    .statusBarHidden(barsHidden)
    .persistentSystemOverlays(barsHidden ? .hidden : .automatic)
  }
}

struct PageStrip: UIViewRepresentable {
  let chapters: [StripChapter]
  let start: Int
  let barsHidden: Bool
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

  static func dismantleUIView(_ view: UIScrollView, coordinator: StripController) {
    coordinator.stop()
  }

  private func update(_ controller: StripController) {
    controller.onPage = onPage
    controller.onTap = onTap
    controller.onScroll = onScroll
    controller.bar.set(hidden: barsHidden)
    controller.show(chapters: chapters, start: start)
  }
}

final class StripScrollView: UIScrollView {
  var onLayout: () -> Void = {}
  var onWindow: () -> Void = {}

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { onWindow() }
  }
}

// UIKit drops every touch of the edge swipe back while the navigation bar is hidden, so the reader fades the bar out instead
// of hiding it: a bar at zero alpha takes no touches, and the swipe keeps working.
final class BarFade: NSObject {
  private weak var navigation: UINavigationController?
  private var hidden = true

  func attach(from view: UIView) {
    var responder: UIResponder? = view
    while let current = responder, !(current is UINavigationController) {
      responder = current.next
    }
    guard let found = responder as? UINavigationController else { return }
    if found !== navigation {
      navigation?.interactivePopGestureRecognizer?.removeTarget(self, action: #selector(swiped(_:)))
      navigation = found
      found.interactivePopGestureRecognizer?.addTarget(self, action: #selector(swiped(_:)))
    }
    // Pushed, the bar fades out with the transition rather than vanishing as it starts.
    if let coordinator = found.transitionCoordinator {
      coordinator.animate(alongsideTransition: { _ in self.apply() })
    } else {
      apply()
    }
  }

  func set(hidden: Bool) {
    guard hidden != self.hidden else { return }
    self.hidden = hidden
    UIView.animate(withDuration: 0.2) { self.apply() }
  }

  // The list's bar fades in with the swipe back, and out again if the swipe is cancelled.
  @objc private func swiped(_ gesture: UIGestureRecognizer) {
    guard gesture.state == .began, let coordinator = navigation?.transitionCoordinator else { return }
    coordinator.animate(
      alongsideTransition: { _ in self.navigation?.navigationBar.alpha = 1 },
      completion: { context in if context.isCancelled { self.apply() } })
  }

  // A reader replaced by another one leaves the bar to it; one popped back to the list shows it.
  func detach() {
    guard let navigation else { return }
    navigation.interactivePopGestureRecognizer?.removeTarget(self, action: #selector(swiped(_:)))
    if navigation.viewControllers.count <= 1 { navigation.navigationBar.alpha = 1 }
    self.navigation = nil
  }

  private func apply() {
    navigation?.navigationBar.alpha = hidden ? 0 : 1
  }
}

final class StripController: NSObject, UIScrollViewDelegate {
  // Black shows through between pages, as a thin line where one ends.
  private static let gap: CGFloat = 1

  let scrollView = StripScrollView()
  let bar = BarFade()
  private var chapters: [StripChapter] = []
  private var pageViews: [PageView] = []
  // Height over width of each page; a page keeps a typical manga shape until its image arrives.
  private var aspects: [CGFloat] = []
  private var pendingStart: Int?
  // Every page asked for ahead, with its download while one runs.
  private var prefetches: [URL: URLSessionDataTask?] = [:]
  private var current = -1
  private var laidOutWidth: CGFloat = 0
  var onPage: (Int) -> Void = { _ in }
  var onTap: () -> Void = {}
  var onScroll: () -> Void = {}

  override init() {
    super.init()
    scrollView.delegate = self
    scrollView.backgroundColor = .black
    scrollView.contentInsetAdjustmentBehavior = .never
    scrollView.onLayout = { [weak self] in self?.fit() }
    scrollView.onWindow = { [weak self] in
      if let self { self.bar.attach(from: self.scrollView) }
    }
    scrollView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
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
    // The old pages stop their downloads, so a strip that starts over does not decode images nobody sees.
    stop()
    pageViews.forEach { $0.removeFromSuperview() }
    pageViews = []
    aspects = []
    self.chapters = chapters
    current = -1
    chapters.forEach(add)
    pendingStart = min(max(start, 0), max(pageViews.count - 1, 0))
    layout()
  }

  private func add(_ chapter: StripChapter) {
    for url in chapter.pages {
      let index = pageViews.count
      let view = PageView(url: url)
      view.onAspect = { [weak self] aspect in self?.resize(index, to: aspect) }
      scrollView.addSubview(view)
      pageViews.append(view)
      aspects.append(1.42)
    }
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
    var y: CGFloat = 0
    for (index, view) in pageViews.enumerated() {
      let height = (width * aspects[index]).rounded()
      view.frame = CGRect(x: 0, y: y, width: width, height: height)
      y += height + Self.gap
    }
    scrollView.contentSize = CGSize(width: width, height: max(y - Self.gap, 0))
    // The start waits for the window, whose safe area sets the inset it scrolls past.
    if let start = pendingStart, start < pageViews.count, scrollView.window != nil {
      pendingStart = nil
      let top = scrollView.contentInset.top
      scrollView.contentOffset = CGPoint(x: 0, y: min(pageViews[start].frame.minY - top, bottomOffset))
    }
    track()
  }

  private var bottomOffset: CGFloat {
    max(
      scrollView.contentSize.height - scrollView.bounds.height + scrollView.contentInset.bottom,
      -scrollView.contentInset.top)
  }

  // A page above the screen that grows or shrinks moves the offset with it, so what is on screen stays put.
  private func resize(_ index: Int, to aspect: CGFloat) {
    guard index < aspects.count, abs(aspects[index] - aspect) > 0.001 else { return }
    let above = pageViews[index].frame.maxY <= scrollView.contentOffset.y + scrollView.contentInset.top
    let delta = (laidOutWidth * aspect).rounded() - (laidOutWidth * aspects[index]).rounded()
    aspects[index] = aspect
    layout()
    if above {
      scrollView.contentOffset.y += delta
    }
  }

  // The page under the middle of the screen is the one being read; only pages near it hold their images.
  // Until the strip has scrolled to its start, the top page is not the one being read, so nothing is reported.
  // A short last page never reaches the middle, so the strip scrolled to its end is read to its last page.
  private func track() {
    guard !pageViews.isEmpty, pendingStart == nil else { return }
    let middle = scrollView.contentOffset.y + scrollView.bounds.height / 2
    let index =
      scrollView.contentOffset.y >= bottomOffset - 1
      ? pageViews.count - 1 : pageViews.firstIndex { $0.frame.maxY > middle } ?? pageViews.count - 1
    for (position, view) in pageViews.enumerated() {
      if position >= index - 2 && position <= index + 4 {
        view.load()
      } else if position < index - 6 || position > index + 8 {
        view.unload()
      }
      if position > index + 4 && position <= index + 16 {
        prefetch(view)
      }
    }
    if index != current {
      current = index
      onPage(index)
    }
  }

  // The image hosts take a second or two per page, so the pages after the loaded ones download ahead into the disk cache.
  private func prefetch(_ view: PageView) {
    guard let url = view.url, prefetches[url] == nil else { return }
    prefetches.updateValue(PageLoader.prefetch(url), forKey: url)
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    track()
    if scrollView.isDragging { onScroll() }
  }

  @objc private func tapped() {
    onTap()
  }

  // Leaving the reader stops every download and decode it started, and gives the list its bar back.
  func stop() {
    bar.detach()
    pageViews.forEach { $0.unload() }
    prefetches.values.forEach { $0?.cancel() }
    prefetches = [:]
  }
}

// A page spins while its image is on its way and tries again after a failure, so a page is never silently black.
final class PageView: UIImageView, UIContextMenuInteractionDelegate {
  let url: URL?
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let failure = UIImageView(image: UIImage(systemName: "arrow.clockwise"))
  private var task: Task<Void, Never>?
  private var failures = 0
  var onAspect: (CGFloat) -> Void = { _ in }

  init(url: String) {
    self.url = URL(string: url)
    super.init(frame: .zero)
    contentMode = .scaleAspectFit
    isUserInteractionEnabled = true
    spinner.color = .gray
    spinner.hidesWhenStopped = true
    failure.tintColor = .gray
    failure.isHidden = true
    addSubview(spinner)
    addSubview(failure)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    spinner.center = CGPoint(x: bounds.midX, y: bounds.midY)
    failure.center = spinner.center
  }

  func load() {
    guard image == nil, task == nil, let url else { return }
    spinner.startAnimating()
    failure.isHidden = true
    task = Task { [weak self] in
      let loaded = await PageLoader.image(url, size: 2400)
      guard let self, !Task.isCancelled else { return }
      guard let loaded, loaded.size.width > 0 else {
        // Two, four, then eight seconds, while the page stays near the screen.
        self.failures += 1
        self.spinner.stopAnimating()
        self.failure.isHidden = false
        try? await Task.sleep(for: .seconds(min(pow(2, Double(self.failures)), 8)))
        guard !Task.isCancelled else { return }
        self.task = nil
        self.load()
        return
      }
      self.task = nil
      self.failures = 0
      self.spinner.stopAnimating()
      self.image = loaded
      self.onAspect(loaded.size.height / loaded.size.width)
    }
  }

  func unload() {
    task?.cancel()
    task = nil
    spinner.stopAnimating()
    failure.isHidden = true
    image = nil
  }

  // Holding a page offers to copy it, as Photos does.
  func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint)
    -> UIContextMenuConfiguration?
  {
    guard let image else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { _ in
      UIMenu(children: [
        UIAction(title: "Copy", image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.image = image },
        UIAction(title: "Share", image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in
          self?.share(image)
        },
      ])
    }
  }

  private func share(_ image: UIImage) {
    var responder: UIResponder? = self
    while let current = responder, !(current is UIViewController) {
      responder = current.next
    }
    guard let controller = responder as? UIViewController else { return }
    let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = self
    controller.present(sheet, animated: true)
  }
}

enum PageLoader {
  // Pages never change at their link, so a read chapter opens again from the disk without the network.
  private static let cache = URLCache(
    memoryCapacity: 16 << 20, diskCapacity: 1 << 30,
    directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
      .appendingPathComponent("pages"))

  private static let session = makeSession(connections: 6)
  // Downloads ahead take two connections of their own, so they never hold up the page on screen.
  private static let ahead = makeSession(connections: 2)

  private static func makeSession(connections: Int) -> URLSession {
    let configuration = URLSessionConfiguration.default
    configuration.urlCache = cache
    configuration.requestCachePolicy = .returnCacheDataElseLoad
    configuration.httpMaximumConnectionsPerHost = connections
    configuration.timeoutIntervalForRequest = 20
    return URLSession(configuration: configuration)
  }

  // No download when the page is already on disk.
  static func prefetch(_ url: URL) -> URLSessionDataTask? {
    guard cache.cachedResponse(for: URLRequest(url: url)) == nil else { return nil }
    let task = ahead.dataTask(with: url) { _, _, _ in }
    task.resume()
    return task
  }

  // `size` is the longest side in pixels: a whole screen for a page, a few points for a cover. An error page or bytes
  // that are no image leave the cache, so the next try downloads the page again.
  static func image(_ url: URL, size: Int) async -> UIImage? {
    guard let (data, response) = try? await session.data(from: url), !Task.isCancelled else { return nil }
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let image = await Task.detached(priority: .userInitiated, operation: { decode(data, size: size) }).value
    else {
      cache.removeCachedResponse(for: URLRequest(url: url))
      return nil
    }
    return image
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
