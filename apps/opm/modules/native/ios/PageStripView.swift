import ExpoModulesCore
import ExpoUI
import ImageIO
import SwiftUI
import UIKit

public final class PageStripViewProps: UIBaseViewProps {
  @Field var chapters: [Int] = []
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
      chapters: props.chapters,
      pages: props.pages,
      start: props.start,
      barsHidden: barsHidden,
      onPage: { index in props.onPage(["index": index]) },
      onTap: { barsHidden.toggle() },
      onScroll: { barsHidden = true }
    )
    // Edge to edge, under the bars and the Dynamic Island, which may cover a page's corner.
    .ignoresSafeArea()
    .background(Color.black)
    .statusBarHidden(barsHidden)
    .persistentSystemOverlays(barsHidden ? .hidden : .automatic)
  }
}

struct PageStrip: UIViewRepresentable {
  let chapters: [Int]
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
    controller.show(chapters: chapters, pages: pages, start: start)
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

// UIKit drops every touch of the edge swipe back while the navigation bar is hidden, so the reader fades the bars out instead
// of hiding them; touches pass through a bar with nothing to tap, and the swipe keeps working.
final class BarFade: NSObject {
  private weak var navigation: UINavigationController?
  private var shown: [NSKeyValueObservation] = []
  private weak var content: UIScrollView?
  // The navigation bar fades out through a mask, never its own alpha: iOS 27 drops Back from a stack that lays out its bar at
  // zero alpha, as a push, a fold or a turn does, and leaves it out once the bar shows again. Shown, the bar draws without
  // it. Far larger than any bar, so it covers the bar's background above it as the bar resizes.
  private let veil = UIView(frame: CGRect(x: -5000, y: -5000, width: 10000, height: 10000))
  // The reader's controller in its stack, whose appearance the bars take while it is on top.
  private weak var reader: UIViewController?
  private var hidden = true

  override init() {
    super.init()
    veil.backgroundColor = .black
  }

  func attach(from view: UIScrollView) {
    content = view
    var responder: UIResponder? = view
    var controller: UIViewController?
    while let current = responder, !(current is UINavigationController) {
      if let current = current as? UIViewController { controller = current }
      responder = current.next
    }
    guard let found = responder as? UINavigationController else { return }
    // Since iOS 26 a bar has no material of its own, only a blur of what is under it, so over the reader's black pages a title
    // in the light appearance cannot be read; the reader takes the dark one, which the floating bars over it follow. The
    // navigation bar takes the appearance of the controller on top only as it shows again after hiding, which the mask never
    // does, so the reader's own bar appearance makes its title light; UIKit swaps that in and out with the reader.
    if controller !== reader {
      reader?.overrideUserInterfaceStyle = .unspecified
      reader = controller
      controller?.overrideUserInterfaceStyle = .dark
      if let item = controller?.navigationItem {
        let appearance = UINavigationBarAppearance(barAppearance: found.navigationBar.standardAppearance)
        appearance.titleTextAttributes[.foregroundColor] = UIColor.white
        item.standardAppearance = appearance
        item.compactAppearance = appearance
        item.scrollEdgeAppearance = appearance
        item.compactScrollEdgeAppearance = appearance
      }
    }
    if found !== navigation {
      release(showing: true)
      navigation = found
      found.interactivePopGestureRecognizer?.addTarget(self, action: #selector(swiped(_:)))
      // The stack shows its floating bars again each time it lays them out, which a fold does for a while after the reader is
      // in, as the status bar moves to the other screen; outside a push or a pop, they fade out again once that pass ends.
      shown = found.view.subviews.filter { !view.isDescendant(of: $0) && $0 !== found.navigationBar }.map {
        $0.observe(\.alpha) { [weak self] bar, _ in
          guard let self, self.hidden, bar.alpha > 0, self.navigation?.transitionCoordinator == nil else { return }
          DispatchQueue.main.async { [weak self] in self?.apply() }
        }
      }
    }
    // Pushed, the bars fade out with the transition rather than vanishing as it starts.
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
      alongsideTransition: { _ in self.fade(1) },
      completion: { context in if context.isCancelled { self.apply() } })
  }

  func detach() {
    reader?.overrideUserInterfaceStyle = .unspecified
    reader = nil
    guard let navigation else { return }
    release(showing: navigation.viewControllers.count <= 1)
    self.navigation = nil
  }

  // The stack the reader leaves, for another column's stack in a fold or a turn or for the list when it closes, shows its bars
  // again; a stack another reader took meanwhile keeps that reader's mask.
  private func release(showing: Bool) {
    guard let navigation else { return }
    shown = []
    navigation.interactivePopGestureRecognizer?.removeTarget(self, action: #selector(swiped(_:)))
    if showing { fade(1) }
    if navigation.navigationBar.mask === veil { navigation.navigationBar.mask = nil }
  }

  private func apply() {
    fade(hidden ? 0 : 1)
  }

  // Every bar over the reader, not only the navigation bar: iOS 27 floats Back and the bar's buttons in a view of their own
  // beside it, which the navigation bar's mask does not reach. Hidden, the strip drops the blur iOS 26 draws under its bars.
  private func fade(_ alpha: CGFloat) {
    guard let navigation, let content else { return }
    for view in navigation.view.subviews where !content.isDescendant(of: view) && view !== navigation.navigationBar {
      view.alpha = alpha
    }
    if alpha > 0 {
      veil.alpha = 1
      navigation.navigationBar.mask = nil
    } else {
      UIView.performWithoutAnimation { navigation.navigationBar.mask = veil }
      veil.alpha = 0
    }
    content.topEdgeEffect.isHidden = alpha == 0
  }
}

// Pages turned right to left one at a time, each filling the window, or in a window wide like an open book, two-page spreads.
final class StripController: NSObject, UIScrollViewDelegate {
  // Black shows through between a spread's pages, as a thin line where one ends.
  private static let gap: CGFloat = 1

  let scrollView = StripScrollView()
  let bar = BarFade()
  private var pages: [String] = []
  // How many pages each chapter of the strip has, in order.
  private var chapters: [Int] = []
  private var pageViews: [PageView] = []
  // Height over width of each page; a page keeps a typical manga shape until its image arrives.
  private var aspects: [CGFloat] = []
  private var pendingStart: Int?
  // The pages with an image or a download near the screen, and the downloads ahead, by index; scrolling touches only these.
  private var loaded = Set<Int>()
  private var prefetches: [Int: Task<Void, Never>] = [:]
  private var current = -1
  private var laidOutSize: CGSize = .zero
  // Until the reader drags, the chapter sits where it was restored, which may be its last turn without the last page being read.
  private var dragged = false
  // The turns, rightmost first, each one page or a spread's right and left page.
  private var spreads: [[Int]] = []
  private var spread = false
  private var laidOutGutter: CGFloat = 0
  // A spread that pairs differently while a turn is under way waits for the turn to end, so it does not jump under the finger.
  private var settled = true
  var onPage: (Int) -> Void = { _ in }
  var onTap: () -> Void = {}
  var onScroll: () -> Void = {}

  override init() {
    super.init()
    scrollView.delegate = self
    scrollView.backgroundColor = .black
    scrollView.contentInsetAdjustmentBehavior = .never
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.isPagingEnabled = true
    // A chapter of one turn still takes a drag, which reads its last page and adds the next chapter.
    scrollView.alwaysBounceHorizontal = true
    scrollView.onLayout = { [weak self] in self?.fit() }
    scrollView.onWindow = { [weak self] in
      if let self {
        self.fit()
        self.bar.attach(from: self.scrollView)
      }
    }
    scrollView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    // Bending the phone into a book opens a gap at the crease without resizing the window; the spread moves its pages off it.
    // The hinge ships in the iOS 27.1 SDK, whose UIKit is 9127.0.85.
    #if canImport(UIKit, _version: 9127.0.85)
      if #available(iOS 27.1, *) {
        scrollView.addInteraction(UIHingeInteraction { [weak self] _, _ in self?.scrollView.setNeedsLayout() })
      }
    #endif
  }

  // Appending pages extends the chapter in place; anything else starts over at `start`.
  func show(chapters: [Int], pages: [String], start: Int) {
    self.chapters = chapters
    if pages == self.pages { return }
    if !self.pages.isEmpty && pages.count > self.pages.count && pages.starts(with: self.pages)
    {
      pages[self.pages.count...].forEach(add)
      self.pages = pages
      layout()
      return
    }
    // The old pages stop their downloads, so a chapter that starts over does not decode images nobody sees.
    stop()
    pageViews.forEach { $0.removeFromSuperview() }
    pageViews = []
    aspects = []
    spreads = []
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

  // Spreads only where two pages stand at a readable size side by side: the unfolded phone's landscape window, with the reader
  // across both halves. Folded, upright, half open like a laptop or beside the chapter list, each page turns alone.
  private var fitsSpreads: Bool {
    guard let window = scrollView.window else { return false }
    let size = scrollView.bounds.size
    return window.traitCollection.horizontalSizeClass == .regular && window.bounds.width > window.bounds.height
      && size.width > size.height
  }

  private func fit() {
    if fitsSpreads != spread || scrollView.bounds.size != laidOutSize || pendingStart != nil
      || (spread && gutter().lowerBound != laidOutGutter)
    {
      layout()
    }
  }

  // A fold or a turn keeps the focused page: folding turns to it, unfolding opens the spread holding it.
  private func layout() {
    let fits = fitsSpreads
    guard scrollView.bounds.width > 0 else { return }
    if (fits != spread || scrollView.bounds.width != laidOutSize.width) && pendingStart == nil && current >= 0 {
      pendingStart = current
    }
    if fits != spread {
      spread = fits
      spreads = []
      settled = true
      dragged = false
      scrollView.contentOffset = .zero
    }
    layoutSpreads()
    track()
  }

  // Each chapter's first page, its cover, stands alone; the pages after it pair a right page then a left one, as a printed manga
  // reads. A page already as wide as a spread stands alone, and so does a page before it or at the end of a chapter; pairing
  // goes on after it.
  private var pairs: [[Int]] {
    if !spread { return pageViews.indices.map { [$0] } }
    var pairs: [[Int]] = []
    var start = 0
    for count in chapters + [pageViews.count] where start < pageViews.count {
      let end = min(start + count, pageViews.count)
      var index = start
      while index < end {
        if index > start && index + 1 < end && aspects[index] >= 1 && aspects[index + 1] >= 1 {
          pairs.append([index, index + 1])
          index += 2
        } else {
          pairs.append([index])
          index += 1
        }
      }
      start = end
    }
    return pairs
  }

  private func layoutSpreads() {
    let next = pairs
    let size = scrollView.bounds.size
    let moving = scrollView.isDragging || scrollView.isDecelerating
    let turned = next != spreads || size != laidOutSize
    if turned && moving && pendingStart == nil {
      settled = false
      return
    }
    let gutter = gutter()
    let anchor = pendingStart ?? max(current, 0)
    // The whole window's height, the Dynamic Island over a corner of the page rather than a band of black under it.
    let height = size.height
    for (position, pair) in next.enumerated() {
      let origin = CGFloat(next.count - 1 - position) * size.width
      // A page alone fills the window, centred, as wide or as tall as it fits.
      if !spread || (pair.count == 1 && aspects[pair[0]] < 1) {
        let width = min(size.width, height / aspects[pair[0]])
        place(pair[0], x: origin + (size.width - width) / 2, width: width, height: height)
        continue
      }
      // Both pages of a spread stand the same height, as in a printed book, however much room each side of the crease has.
      let tall = pair.count == 2 ? (gutter.lowerBound * aspects[pair[1]]) : height
      let pageHeight = min(height, (size.width - gutter.upperBound) * aspects[pair[0]], tall)
      place(pair[0], x: origin + gutter.upperBound, width: pageHeight / aspects[pair[0]], height: height)
      if pair.count == 2 {
        let left = pageHeight / aspects[pair[1]]
        place(pair[1], x: origin + gutter.lowerBound - left, width: left, height: height)
      }
    }
    scrollView.contentSize = CGSize(width: CGFloat(next.count) * size.width, height: size.height)
    spreads = next
    laidOutSize = size
    laidOutGutter = gutter.lowerBound
    guard turned || pendingStart != nil, scrollView.window != nil,
      let position = next.firstIndex(where: { $0.contains(anchor) })
    else { return }
    pendingStart = nil
    scrollView.contentOffset = CGPoint(x: CGFloat(next.count - 1 - position) * size.width, y: 0)
  }

  private func place(_ index: Int, x: CGFloat, width: CGFloat, height: CGFloat) {
    let pageHeight = (width * aspects[index]).rounded()
    pageViews[index].frame = CGRect(x: x, y: ((height - pageHeight) / 2).rounded(), width: width, height: pageHeight)
  }

  // Where the two pages of a spread meet, across the screen: the crease's reserved band when the phone is bent like a book,
  // otherwise a thin line at the window's middle.
  private func gutter() -> ClosedRange<CGFloat> {
    let bounds = scrollView.bounds
    #if canImport(UIKit, _version: 9127.0.85)
      if #available(iOS 27.1, *) {
        for region in scrollView.reservedRegions(kind: .division) where region.isActive {
          let band = region.frame.offsetBy(dx: -bounds.minX, dy: -bounds.minY)
          if band.height > band.width && band.minX > 0 && band.maxX < bounds.width { return band.minX...band.maxX }
        }
      }
    #endif
    let middle = scrollView.window.map { scrollView.convert(CGPoint(x: $0.bounds.midX, y: 0), from: $0).x - bounds.minX }
    let crease = (middle ?? bounds.width / 2).rounded()
    return crease - Self.gap / 2...crease + Self.gap / 2
  }

  // A page's shape arriving lays the turns out again: a wide page can end a spread's pairing.
  private func resize(_ index: Int, to aspect: CGFloat) {
    guard index < aspects.count, abs(aspects[index] - aspect) > 0.001 else { return }
    aspects[index] = aspect
    layout()
  }

  // Until the chapter has turned to its start, the turn on screen is not the one being read, so nothing is reported. The last
  // turn the reader dragged to counts its last page as read.
  // Only the reader's own turning moves the focused page: a fold or a turn lays the pages out at passing sizes on the way,
  // where the turn on screen is not the one being read, until the last layout brings back the focused one.
  private func track(moved: Bool = false) {
    guard !pageViews.isEmpty, pendingStart == nil else { return }
    let last = pageViews.count - 1
    let index = !moved && current >= 0 ? current : spreadIndex()
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

  // The turn on screen's right page; a page focused alone stays the focus while its spread is open.
  private func spreadIndex() -> Int {
    guard !spreads.isEmpty, laidOutSize.width > 0 else { return max(current, 0) }
    let turned = Int((scrollView.contentOffset.x / laidOutSize.width).rounded())
    let position = min(max(spreads.count - 1 - turned, 0), spreads.count - 1)
    if dragged && position == spreads.count - 1 { return pageViews.count - 1 }
    return spreads[position].contains(current) ? current : spreads[position][0]
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    dragged = true
  }

  // A page turns only once it settles: a turn dragged past halfway and let go back leaves the reader on the page it was.
  func scrollViewDidScroll(_ scrollView: UIScrollView) {
    track()
    if scrollView.isDragging { onScroll() }
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    if decelerate { return }
    track(moved: true)
    settle()
  }

  func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
    track(moved: true)
    settle()
  }

  private func settle() {
    guard !settled else { return }
    settled = true
    layout()
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
