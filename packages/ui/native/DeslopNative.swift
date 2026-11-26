import AuthenticationServices
import Capacitor
import Foundation
import Security
import UIKit
import WebKit

@MainActor
@objc(DeslopNativePlugin)
final class DeslopNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    nonisolated let identifier = "DeslopNativePlugin"
    nonisolated let jsName = "DeslopNative"
    nonisolated let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "config", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "account", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSocket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSocket", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeSocket", returnType: CAPPluginReturnPromise)
    ]

    private var authentication: ASWebAuthenticationSession?
    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration, delegate: DeslopSessionDelegate(plugin: self), delegateQueue: nil)
    }()

    // Capacitor routes external top-level links to the system, but otherwise allows external frames.
    override nonisolated func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        MainActor.assumeIsolated {
            guard let local = bridge?.config.localURL, let url = navigationAction.request.url else { return NSNumber(value: true) }
            let bundled = url.scheme == local.scheme && url.host == local.host && url.port == local.port
                && url.user == nil && url.password == nil
            if bundled { return nil }
            if navigationAction.targetFrame?.isMainFrame == false || url.scheme == local.scheme { return NSNumber(value: true) }
            return nil
        }
    }

    @objc nonisolated func config(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                call.resolve(["bundle": Bundle.main.bundleIdentifier ?? "", "server": try origin("DeslopServer").absoluteString])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc nonisolated func account(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                let url = try origin("DeslopServer").appendingPathComponent("api/account")
                let (data, response) = try await session.data(for: authorizedRequest(url))
                guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
                call.resolve(["status": response.statusCode, "body": String(decoding: data, as: UTF8.self)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc nonisolated func signIn(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard authentication == nil else {
                call.reject("Sign-in is already open.")
                return
            }
            do {
                let auth = try origin("DeslopAuth")
                let slug = Bundle.main.object(forInfoDictionaryKey: "DeslopSlug") as? String
                guard let slug, !slug.isEmpty, auth.scheme == "https", let host = auth.host,
                      var start = URLComponents(url: auth.appendingPathComponent("sign-in"), resolvingAgainstBaseURL: false)
                else { throw URLError(.badURL) }
                start.queryItems = [URLQueryItem(name: "app", value: slug)]
                guard let url = start.url else { throw URLError(.badURL) }
                let browser = ASWebAuthenticationSession(url: url, callback: .https(host: host, path: "/signed-in/\(slug)")) {
                    [weak self] url, error in
                    Task { @MainActor in
                        guard let self else { return }
                        self.authentication = nil
                        if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                            call.resolve(["signedIn": false])
                            return
                        }
                        if let error {
                            call.reject(error.localizedDescription)
                            return
                        }
                        let query = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?.queryItems
                        if let reason = query?.first(where: { $0.name == "error" })?.value {
                            call.reject(reason)
                            return
                        }
                        guard let secret = query?.first(where: { $0.name == "session" })?.value, !secret.isEmpty else {
                            call.reject("Auth did not return a session.")
                            return
                        }
                        do {
                            try DeslopKeychain.write(secret)
                            call.resolve(["signedIn": true])
                        } catch {
                            call.reject(error.localizedDescription)
                        }
                    }
                }
                browser.presentationContextProvider = self
                authentication = browser
                if !browser.start() {
                    authentication = nil
                    call.reject("The sign-in sheet could not open.")
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    @objc nonisolated func signOut(_ call: CAPPluginCall) {
        Task { @MainActor in
            var status = 0
            do {
                let auth = try origin("DeslopAuth")
                var request = try authorizedRequest(auth.appendingPathComponent("sign-out"))
                request.httpMethod = "POST"
                request.timeoutInterval = 10
                request.setValue(auth.absoluteString, forHTTPHeaderField: "Origin")
                let (_, response) = try await session.data(for: request)
                status = (response as? HTTPURLResponse)?.statusCode ?? 0
            } catch {
                // A lost connection does not keep this app's copy of the session.
            }
            do {
                try DeslopKeychain.clear()
                for id in Array(sockets.keys) {
                    close(id, code: .goingAway)
                }
                call.resolve(["status": status])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc nonisolated func openSocket(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let id = call.getString("id"), sockets[id] == nil else {
                call.reject("A new socket ID is required.")
                return
            }
            do {
                let server = try origin("DeslopServer")
                var endpoint = URLComponents(url: server.appendingPathComponent("api/rpc"), resolvingAgainstBaseURL: false)
                endpoint?.scheme = server.scheme == "https" ? "wss" : "ws"
                guard let url = endpoint?.url else { throw URLError(.badURL) }
                let socket = session.webSocketTask(with: try authorizedRequest(url))
                socket.maximumMessageSize = 10 * 1024 * 1024
                sockets[id] = socket
                socket.resume()
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc nonisolated func sendSocket(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let id = call.getString("id"), let socket = sockets[id],
                  let encoded = call.getString("data"), let data = Data(base64Encoded: encoded)
            else {
                call.reject("An open socket and a binary frame are required.")
                return
            }
            do {
                try await socket.send(.data(data))
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc nonisolated func closeSocket(_ call: CAPPluginCall) {
        Task { @MainActor in
            if let id = call.getString("id") {
                let code = call.getInt("code").flatMap(URLSessionWebSocketTask.CloseCode.init(rawValue:)) ?? .normalClosure
                close(id, code: code)
            }
            call.resolve()
        }
    }

    fileprivate func opened(_ socket: URLSessionWebSocketTask) {
        guard let id = id(for: socket) else { return }
        notifyListeners("socket", data: ["id": id, "type": "open"])
        Task {
            do {
                while sockets[id] === socket {
                    let frame = try await socket.receive()
                    guard sockets[id] === socket else { return }
                    guard case let .data(data) = frame else { throw URLError(.cannotDecodeContentData) }
                    notifyListeners("socket", data: ["id": id, "type": "message", "data": data.base64EncodedString()])
                }
            } catch {
                finished(socket, error: error)
            }
        }
    }

    fileprivate func finished(_ socket: URLSessionWebSocketTask, error: Error?) {
        guard let id = id(for: socket) else { return }
        if socket.closeCode != .invalid {
            close(id, code: socket.closeCode)
        } else if let error {
            sockets.removeValue(forKey: id)
            socket.cancel()
            notifyListeners("socket", data: ["id": id, "type": "error", "message": error.localizedDescription])
        } else {
            close(id, code: .normalClosure)
        }
    }

    private func close(_ id: String, code: URLSessionWebSocketTask.CloseCode) {
        guard let socket = sockets.removeValue(forKey: id) else { return }
        socket.cancel(with: code, reason: nil)
        notifyListeners("socket", data: ["id": id, "type": "close", "code": code.rawValue])
    }

    private func id(for socket: URLSessionWebSocketTask) -> String? {
        sockets.first(where: { $0.value === socket })?.key
    }

    private func origin(_ key: String) throws -> URL {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              let url = URL(string: value), url.host != nil, url.path.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil
        else { throw URLError(.badURL) }
        #if DEBUG
        guard url.scheme == "https" || url.scheme == "http" else { throw URLError(.badURL) }
        #else
        guard url.scheme == "https" else { throw URLError(.badURL) }
        #endif
        return url
    }

    // Auth names the caller from the cookie on the HTTP request or socket upgrade; JavaScript sees neither.
    private func authorizedRequest(_ url: URL) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        if (url.scheme == "https" || url.scheme == "wss"), let secret = try DeslopKeychain.read() {
            request.setValue("__Secure-deslop-session=\(secret)", forHTTPHeaderField: "Cookie")
        }
        return request
    }
}

private final class DeslopSessionDelegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private weak var plugin: DeslopNativePlugin?

    init(plugin: DeslopNativePlugin) {
        self.plugin = plugin
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in plugin?.opened(webSocketTask) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let socket = task as? URLSessionWebSocketTask else { return }
        Task { @MainActor in plugin?.finished(socket, error: error) }
    }

    // An authenticated request may only go to the endpoint bundled in the app.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private enum DeslopKeychain {
    static func query() throws -> [String: Any] {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "DeslopKeychainGroup") as? String, !group.isEmpty
        else { throw URLError(.cannotLoadFromNetwork) }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "Deslop",
            kSecAttrAccount as String: "session",
            kSecAttrAccessGroup as String: group
        ]
    }

    static func read() throws -> String? {
        var query = try query()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        try requireSuccess(status)
        guard let data = item as? Data, let secret = String(data: data, encoding: .utf8)
        else { throw CocoaError(.fileReadCorruptFile) }
        return secret
    }

    static func write(_ secret: String) throws {
        let query = try query()
        let data = Data(secret.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status != errSecItemNotFound {
            try requireSuccess(status)
            return
        }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        try requireSuccess(SecItemAdd(item as CFDictionary, nil))
    }

    static func clear() throws {
        let status = SecItemDelete(try query() as CFDictionary)
        if status != errSecItemNotFound { try requireSuccess(status) }
    }

    private static func requireSuccess(_ status: OSStatus) throws {
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
}
