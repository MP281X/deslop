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
      barsHidden: barsHidden,
      onPage: { index in props.onPage(["index": index]) },
      onTap: { barsHidden.toggle() },
      onScroll: { barsHidden = true }
    )
    .ignoresSafeArea()
    .background(Color.black)
    .statusBarHidden(barsHidden)
    .persistentSystemOverlays(barsHidden ? .hidden : .automatic)
  }
}

struct PageStrip: UIViewRepresentable {
  let pages: [String]
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
    controller.show(pages: pages, start: start)
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
    apply()
  }

  @objc private func swiped(_ gesture: UIGestureRecognizer) {
    guard gesture.state == .began, let coordinator = navigation?.transitionCoordinator else { return }
    coordinator.animate(
      alongsideTransition: { _ in self.navigation?.navigationBar.alpha = 1 },
      completion: { context in if context.isCancelled { self.apply() } })
  }

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
  private var pages: [String] = []
  private var pageViews: [PageView] = []
  // Height over width of each page; a page keeps a typical manga shape until its image arrives.
  private var aspects: [CGFloat] = []
  private var pendingStart: Int?
  // The pages with an image or a download near the screen, and the downloads ahead, by index; scrolling touches only these.
  private var loaded = Set<Int>()
  private var prefetches: [Int: Task<Void, Never>] = [:]
  private var current = -1
  private var laidOutWidth: CGFloat = 0
  private var adjusting = false
  // Until the reader drags, the strip sits where it was restored, which may be the bottom without the last page being read.
  private var dragged = false
  var onPage: (Int) -> Void = { _ in }
  var onTap: () -> Void = {}
  var onScroll: () -> Void = {}

  override init() {
    super.init()
    scrollView.delegate = self
    scrollView.backgroundColor = .black
    scrollView.contentInsetAdjustmentBehavior = .never
    // A strip shorter than the screen still takes a drag, which reads its last page and adds the next chapter.
    scrollView.alwaysBounceVertical = true
    scrollView.onLayout = { [weak self] in self?.fit() }
    scrollView.onWindow = { [weak self] in
      if let self {
        self.fit()
        self.bar.attach(from: self.scrollView)
      }
    }
    scrollView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
  }

  // Appending pages extends the strip in place; anything else starts over at `start`.
  func show(pages: [String], start: Int) {
    if pages == self.pages { return }
    if !self.pages.isEmpty && pages.count > self.pages.count && pages.starts(with: self.pages)
    {
      pages[self.pages.count...].forEach(add)
      self.pages = pages
      layout()
      return
    }
    // The old pages stop their downloads, so a strip that starts over does not decode images nobody sees.
    stop()
    pageViews.forEach { $0.removeFromSuperview() }
    pageViews = []
    aspects = []
    self.pages = pages
    current = -1
    dragged = false
    pages.forEach(add)
    pendingStart = min(max(start, 0), max(pageViews.count - 1, 0))
    layout()
    bar.attach(from: scrollView)
  }

  private func add(_ url: String) {
    let index = pageViews.count
    let view = PageView(url: url)
    view.onAspect = { [weak self] aspect in self?.resize(index, to: aspect) }
    scrollView.addSubview(view)
    pageViews.append(view)
    aspects.append(1.42)
  }

  // The window's safe area, not the view's, so the strip starts below the Dynamic Island whether or not the bars show.
  private func fit() {
    let insets = scrollView.window?.safeAreaInsets ?? .zero
    let inset = UIEdgeInsets(top: insets.top, left: 0, bottom: insets.bottom, right: 0)
    if scrollView.contentInset != inset {
      scrollView.contentInset = inset
      layout()
    } else if scrollView.bounds.width != laidOutWidth || pendingStart != nil {
      layout()
    }
  }

  private func layout(report: Bool = true) {
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
    if report { track() }
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
    adjusting = true
    aspects[index] = aspect
    layout(report: false)
    if above {
      scrollView.contentOffset.y += delta
    }
    adjusting = false
    track()
  }

  // Save and restore the same top-edge anchor, including pages shorter than half the screen.
  // Until the strip has scrolled to its start, the top page is not the one being read, so nothing is reported.
  // At the bottom the reader dragged to, even a short final page counts as read.
  private func track() {
    guard !pageViews.isEmpty, pendingStart == nil, !adjusting else { return }
    let last = pageViews.count - 1
    let index = dragged && scrollView.contentOffset.y >= bottomOffset - 1 ? last : topIndex()
    let shown = max(index - 2, 0)...min(index + 4, last)
    let kept = (index - 6)...(index + 8)
    for position in loaded where !kept.contains(position) {
      pageViews[position].unload()
      loaded.remove(position)
    }
    for position in shown {
      pageViews[position].load()
      loaded.insert(position)
    }
    // The image hosts take a second or two per page, so the pages after the loaded ones download ahead into the disk cache;
    // a download for pages the reader jumped away from stops, and one that failed is tried again when its page comes near.
    let ahead = (index + 5)...(index + 16)
    for (position, task) in prefetches where !ahead.contains(position) {
      task.cancel()
      prefetches.removeValue(forKey: position)
    }
    for position in ahead where position <= last && prefetches[position] == nil {
      if let url = pageViews[position].url { prefetches[position] = PageLoader.prefetch(url) }
    }
    if index != current {
      current = index
      onPage(index)
    }
  }

  // The first page whose bottom is below the top of the screen; pages are laid out in order, so halving finds it.
  private func topIndex() -> Int {
    let top = scrollView.contentOffset.y + scrollView.contentInset.top + 1
    var low = 0
    var high = pageViews.count - 1
    while low < high {
      let middle = (low + high) / 2
      if pageViews[middle].frame.maxY > top { high = middle } else { low = middle + 1 }
    }
    return low
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    dragged = true
  }

  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    track()
    if scrollView.isDragging { onScroll() }
  }

  @objc private func tapped() {
    onTap()
  }

  func stop() {
    bar.detach()
    loaded.forEach { pageViews[$0].unload() }
    loaded = []
    prefetches.values.forEach { $0.cancel() }
    prefetches = [:]
  }
}

final class PageView: UIImageView, UIContextMenuInteractionDelegate {
  let url: URL?
  private let failure = UIImageView(image: UIImage(systemName: "arrow.clockwise"))
  private var task: Task<Void, Never>?
  private var failures = 0
  var onAspect: (CGFloat) -> Void = { _ in }

  init(url: String) {
    self.url = URL(string: url)
    super.init(frame: .zero)
    contentMode = .scaleAspectFit
    isUserInteractionEnabled = true
    backgroundColor = .tertiarySystemFill
    failure.tintColor = .gray
    failure.isHidden = true
    addSubview(failure)
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    failure.center = CGPoint(x: bounds.midX, y: bounds.midY)
  }

  func load() {
    guard image == nil, task == nil, let url else { return }
    failure.isHidden = true
    task = Task { [weak self] in
      let loaded = await PageLoader.image(url, size: 2400)
      guard let self, !Task.isCancelled else { return }
      guard let loaded, loaded.size.width > 0 else {
        // Two, four, then eight seconds, while the page stays near the screen.
        self.failures += 1
        self.failure.isHidden = false
        try? await Task.sleep(for: .seconds(min(pow(2, Double(self.failures)), 8)))
        guard !Task.isCancelled else { return }
        self.task = nil
        self.load()
        return
      }
      self.task = nil
      self.failures = 0
      self.backgroundColor = nil
      self.image = loaded
      self.onAspect(loaded.size.height / loaded.size.width)
    }
  }

  func unload() {
    task?.cancel()
    task = nil
    failure.isHidden = true
    backgroundColor = .tertiarySystemFill
    image = nil
  }

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

// Pages come from whatever hosts a translation links, so the phone loads only public https links, a bounded number of bytes
// and pixels each, and cancels a download nobody waits for.
enum PageLoader {
  private static let maxBytes = 32 << 20
  private static let maxPixels = 64_000_000

  // Pages never change at their link, so a read chapter opens again from the disk without the network. Only a whole page
  // that answered 200 is kept, so an error page or a cut-off download is fetched again.
  private static let cache = URLCache(
    memoryCapacity: 16 << 20, diskCapacity: 1 << 30,
    directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
      .appendingPathComponent("pages"))

  private static let session = makeSession(connections: 6)
  // Downloads ahead take two connections of their own, so they never hold up the page on screen.
  private static let ahead = makeSession(connections: 2)

  private static func makeSession(connections: Int) -> URLSession {
    let configuration = URLSessionConfiguration.default
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.httpMaximumConnectionsPerHost = connections
    configuration.timeoutIntervalForRequest = 20
    return URLSession(configuration: configuration, delegate: Redirects.shared, delegateQueue: nil)
  }

  // A name on the public internet over https: no plain http, no address typed as numbers, no name on the local network.
  static func admits(_ url: URL?) -> Bool {
    guard let url, url.scheme == "https", let host = url.host(percentEncoded: false)?.lowercased(), !host.isEmpty
    else { return false }
    if host == "localhost" || host.hasSuffix(".local") || host.hasSuffix(".localhost") { return false }
    if host.contains(":") || host.allSatisfy({ $0.isNumber || $0 == "." }) { return false }
    return true
  }

  static func prefetch(_ url: URL) -> Task<Void, Never> {
    Task.detached(priority: .utility) {
      let request = URLRequest(url: url)
      if cache.cachedResponse(for: request) == nil { _ = await download(request, session: ahead) }
    }
  }

  // `size` is the longest side in pixels: a whole screen for a page, a few points for a cover. Bytes that are no image
  // leave the cache, so the next try downloads the page again.
  static func image(_ url: URL, size: Int) async -> UIImage? {
    guard admits(url) else { return nil }
    let request = URLRequest(url: url)
    // Off the main thread: reading a download byte by byte and decoding both take long enough to stall scrolling.
    let work = Task.detached(priority: .userInitiated) { () -> UIImage? in
      var data = cache.cachedResponse(for: request)?.data
      if data == nil { data = await download(request, session: session) }
      guard let data, !Task.isCancelled else { return nil }
      guard let image = decode(data, size: size) else {
        cache.removeCachedResponse(for: request)
        return nil
      }
      return image
    }
    return await withTaskCancellationHandler { await work.value } onCancel: { work.cancel() }
  }

  // Stops at `maxBytes`, whatever length the answer claims, and keeps a whole 200 answer for next time.
  private static func download(_ request: URLRequest, session: URLSession) async -> Data? {
    guard admits(request.url),
      let (bytes, response) = try? await session.bytes(for: request),
      let answer = response as? HTTPURLResponse, answer.statusCode == 200,
      answer.expectedContentLength <= Int64(maxBytes)
    else { return nil }
    var data = Data()
    if answer.expectedContentLength > 0 { data.reserveCapacity(Int(answer.expectedContentLength)) }
    do {
      for try await byte in bytes {
        guard data.count < maxBytes else { return nil }
        data.append(byte)
      }
    } catch {
      return nil
    }
    cache.storeCachedResponse(CachedURLResponse(response: answer, data: data), for: request)
    return data
  }

  // Decoding no larger than needed keeps memory flat; a picture with more pixels than any page is not decoded at all.
  private static func decode(_ data: Data, size: Int) -> UIImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0, width <= maxPixels / height
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

// A redirect is followed only to a link the loader would load itself.
final class Redirects: NSObject, URLSessionTaskDelegate, Sendable {
  static let shared = Redirects()

  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(PageLoader.admits(request.url) ? request : nil)
  }
}
