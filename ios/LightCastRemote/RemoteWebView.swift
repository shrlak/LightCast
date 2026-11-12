import SwiftUI
import WebKit

/// The remote page, shown full screen. Cookies and saved computers live in the default (persistent) store.
struct RemoteWebView: UIViewRepresentable {
    let url: URL
    let reload: Int
    @Binding var failure: String?
    var onSettings: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: .zero, configuration: config)
        let dark = UIColor(red: 0.075, green: 0.086, blue: 0.118, alpha: 1)
        web.isOpaque = false
        web.backgroundColor = dark
        web.scrollView.backgroundColor = dark
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        let press = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.longPress(_:)))
        press.numberOfTouchesRequired = 2
        press.minimumPressDuration = 1.0
        press.cancelsTouchesInView = false
        press.delegate = context.coordinator
        web.addGestureRecognizer(press)
        context.coordinator.load(web, url: url)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.loadedURL != url || context.coordinator.loadedReload != reload {
            context.coordinator.load(web, url: url)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, UIGestureRecognizerDelegate {
        var parent: RemoteWebView
        var loadedURL: URL?
        var loadedReload = 0
        init(_ parent: RemoteWebView) { self.parent = parent }

        func load(_ web: WKWebView, url: URL) {
            loadedURL = url
            loadedReload = parent.reload
            web.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
        }

        @objc func longPress(_ gesture: UILongPressGestureRecognizer) {
            if gesture.state == .began { parent.onSettings() }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        // Pages of the remote stay inside the app; any other link opens in Safari.
        func webView(_ web: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard action.targetFrame?.isMainFrame ?? true, let target = action.request.url else { return decisionHandler(.allow) }
            if target.scheme == "about" || target.host == loadedURL?.host { return decisionHandler(.allow) }
            if action.navigationType == .linkActivated { UIApplication.shared.open(target) }
            decisionHandler(.cancel)
        }

        func webView(_ web: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.failure = nil }
        }

        func webView(_ web: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ web: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }

        private func fail(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            DispatchQueue.main.async { self.parent.failure = error.localizedDescription }
        }

        func webViewWebContentProcessDidTerminate(_ web: WKWebView) {
            if let url = loadedURL { load(web, url: url) }
        }
    }
}
