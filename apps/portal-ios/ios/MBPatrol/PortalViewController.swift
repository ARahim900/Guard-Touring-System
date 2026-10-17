import SafariServices
import UIKit
import WebKit

/// MB Security — iPhone shell around the live supervisor portal.
///
/// The app IS the website: it loads the Netlify portal full-screen, so every
/// deploy of `main` reaches the phone with no rebuild. The portal does not paint
/// under the notch, so the shell fills the top inset with the purple top-bar
/// colour and the bottom inset with the bottom-bar white (purple on sign-in).
final class PortalViewController: UIViewController {
    private enum Config {
        static let appURL = URL(string: "https://securitymbpatrolling.netlify.app")!
        /// Hosts that stay inside the app. The Supabase host serves password-reset hops.
        static let inAppHosts: Set<String> = ["securitymbpatrolling.netlify.app", "zdezuylsruzbddqcdhog.supabase.co"]
        static let downloadHandler = "mbDownload"
        static let splashTimeout: TimeInterval = 10
    }

    private enum Colour {
        static let purple = UIColor(red: 0x4E / 255, green: 0x44 / 255, blue: 0x56 / 255, alpha: 1)
        static let page = UIColor(red: 0xF7 / 255, green: 0xF8 / 255, blue: 0xF9 / 255, alpha: 1)
        static let body = UIColor(red: 0x45 / 255, green: 0x45 / 255, blue: 0x45 / 255, alpha: 1)
    }

    private var webView: WKWebView!
    private let topFill = UIView()
    private let bottomFill = UIView()
    private let splash = UIView()
    private let offline = UIStackView()
    private let refresh = UIRefreshControl()
    private var urlObservation: NSKeyValueObservation?

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        buildWebView()
        buildFills()
        buildOffline()
        buildSplash()
        webView.load(URLRequest(url: Config.appURL))
        DispatchQueue.main.asyncAfter(deadline: .now() + Config.splashTimeout) { [weak self] in self?.hideSplash() }
    }

    // MARK: - Layout

    private func buildWebView() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true // camera preview for label scanning
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.applicationNameForUserAgent = "MBPatrolApp/1.0"
        let script = WKUserScript(source: Self.downloadScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        configuration.userContentController.addUserScript(script)
        configuration.userContentController.add(WeakMessageHandler(self), name: Config.downloadHandler)

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.backgroundColor = Colour.page
        webView.isOpaque = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        refresh.addTarget(self, action: #selector(reload), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        // The bottom strip follows the page: purple on sign-in, white elsewhere.
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] webView, _ in
            let onSignIn = webView.url?.path == "/login"
            self?.bottomFill.backgroundColor = onSignIn ? Colour.purple : .white
        }

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
        ])
    }

    private func buildFills() {
        topFill.backgroundColor = Colour.purple
        bottomFill.backgroundColor = .white
        for fill in [topFill, bottomFill] {
            fill.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(fill)
        }
        NSLayoutConstraint.activate([
            topFill.topAnchor.constraint(equalTo: view.topAnchor),
            topFill.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            topFill.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            topFill.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottomFill.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            bottomFill.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bottomFill.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bottomFill.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    private func buildSplash() {
        splash.backgroundColor = Colour.purple
        let mark = UIImageView(image: UIImage(named: "LaunchMark"))
        mark.translatesAutoresizingMaskIntoConstraints = false
        splash.addSubview(mark)
        splash.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(splash)
        NSLayoutConstraint.activate([
            splash.topAnchor.constraint(equalTo: view.topAnchor),
            splash.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            splash.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            splash.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            mark.centerXAnchor.constraint(equalTo: splash.safeAreaLayoutGuide.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: splash.safeAreaLayoutGuide.centerYAnchor),
        ])
    }

    private func buildOffline() {
        let title = UILabel()
        title.text = "Cannot reach MB Security"
        title.font = UIFont(name: "Georgia-Bold", size: 22) ?? .boldSystemFont(ofSize: 22)
        title.textColor = Colour.purple
        let body = UILabel()
        body.text = "Check your connection, then try again."
        body.font = .preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.textColor = Colour.body
        for label in [title, body] {
            label.numberOfLines = 0
            label.textAlignment = .center
        }
        var button = UIButton.Configuration.filled()
        button.title = "Try again"
        button.baseBackgroundColor = Colour.purple
        button.baseForegroundColor = .white
        button.cornerStyle = .fixed
        button.background.cornerRadius = 5
        button.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
        let retry = UIButton(configuration: button, primaryAction: UIAction { [weak self] _ in self?.retry() })

        offline.axis = .vertical
        offline.alignment = .center
        offline.spacing = 14
        offline.isLayoutMarginsRelativeArrangement = true
        offline.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24)
        offline.backgroundColor = Colour.page
        offline.isHidden = true
        [title, body, retry].forEach(offline.addArrangedSubview)
        offline.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(offline)
        NSLayoutConstraint.activate([
            offline.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            offline.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            offline.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            offline.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
        // Centre the content vertically inside the full-screen panel.
        let top = UIView(), bottom = UIView()
        offline.insertArrangedSubview(top, at: 0)
        offline.addArrangedSubview(bottom)
        top.heightAnchor.constraint(equalTo: bottom.heightAnchor).isActive = true
    }

    // MARK: - Actions

    private func hideSplash() {
        guard splash.superview != nil else { return }
        UIView.animate(withDuration: 0.2, animations: { self.splash.alpha = 0 }, completion: { _ in self.splash.removeFromSuperview() })
    }

    @objc private func reload() {
        if webView.url == nil { webView.load(URLRequest(url: Config.appURL)) } else { webView.reload() }
    }

    private func retry() {
        offline.isHidden = true
        reload()
    }

    private func isInApp(_ url: URL?) -> Bool {
        guard let host = url?.host?.lowercased() else { return false }
        return Config.inAppHosts.contains(host)
    }

    private func openOutside(_ url: URL) {
        if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            present(SFSafariViewController(url: url), animated: true)
            return
        }
        UIApplication.shared.open(url) { [weak self] opened in
            if !opened { self?.showAlert(title: "Cannot open link", message: "No app on this iPhone can open this link.") }
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    // MARK: - Downloads

    /// Exports (report PDF/CSV, scan CSV, label images) are made in the page as
    /// blob: or data: links with a download name. This script hands the file to
    /// the app, which opens the share sheet (Save to Files, Mail, AirDrop). Blobs
    /// are remembered when created because the page may revoke the link straight
    /// after clicking it.
    private static let downloadScript = """
    (function () {
      if (window.__mbDownloads) return;
      window.__mbDownloads = true;
      var blobs = {};
      var create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (obj) {
        var url = create(obj);
        if (obj instanceof Blob) blobs[url] = obj;
        return url;
      };
      var revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = function (url) {
        setTimeout(function () { delete blobs[url]; revoke(url); }, 60000);
      };
      function post(name, mime, data) {
        window.webkit.messageHandlers.\(Config.downloadHandler).postMessage({ name: name, mime: mime, data: data });
      }
      function send(a) {
        var href = a.getAttribute('href') || '';
        var name = a.getAttribute('download') || 'download';
        var match = /^data:([^;,]*)(;base64)?,(.*)$/.exec(href);
        if (match) {
          post(name, match[1] || 'application/octet-stream', match[2] ? match[3] : btoa(unescape(decodeURIComponent(match[3]))));
          return true;
        }
        var blob = blobs[href];
        if (!blob) return false;
        var reader = new FileReader();
        reader.onload = function () { post(name, blob.type || 'application/octet-stream', String(reader.result).split(',')[1] || ''); };
        reader.readAsDataURL(blob);
        return true;
      }
      var click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.hasAttribute('download') && send(this)) return;
        return click.apply(this, arguments);
      };
      HTMLAnchorElement.prototype.dispatchEvent = function (event) {
        if (event && event.type === 'click' && this.hasAttribute('download') && send(this)) return false;
        return EventTarget.prototype.dispatchEvent.call(this, event);
      };
      document.addEventListener('click', function (event) {
        var a = event.target && event.target.closest ? event.target.closest('a[download]') : null;
        if (a && send(a)) event.preventDefault();
      }, true);
    })();
    """

    fileprivate func handleDownload(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              Config.inAppHosts.contains(message.frameInfo.securityOrigin.host.lowercased()),
              let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let base64 = body["data"] as? String,
              let data = Data(base64Encoded: base64) else { return }

        // Keep only safe characters: the name comes from the page.
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._- "))
        var safeName = String(name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }.prefix(120))
        if safeName.isEmpty { safeName = "download" }

        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent(safeName)
            try data.write(to: file, options: .atomic)
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = share.popoverPresentationController { // iPad
                popover.sourceView = view
                popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            present(share, animated: true)
        } catch {
            showAlert(title: "Could not save the file", message: "Please try the export again.")
        }
    }
}

// MARK: - Navigation

extension PortalViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        // Sub-frames and in-page schemes load as normal.
        if navigationAction.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        if let scheme = url.scheme?.lowercased(), ["about", "blob", "data"].contains(scheme) { return decisionHandler(.allow) }
        if isInApp(url) { return decisionHandler(.allow) }
        openOutside(url) // other websites, tel:, mailto:, maps: …
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offline.isHidden = true
        refresh.endRefreshing()
        hideSplash()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    private func handleFailure(_ error: Error) {
        refresh.endRefreshing()
        hideSplash()
        let nsError = error as NSError
        // A cancelled load (a newer navigation replaced it) is not a failure.
        guard !(nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled) else { return }
        if nsError.domain == NSURLErrorDomain { offline.isHidden = false }
    }

    /// iOS can kill the web process under memory pressure, leaving a blank page.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reload()
    }
}

// MARK: - Browser dialogs, pop-ups and camera

extension PortalViewController: WKUIDelegate {
    /// window.open / target="_blank": portal pages open here, others outside.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isInApp(url) { webView.load(navigationAction.request) } else { openOutside(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    /// The portal asks before deleting or disabling things (window.confirm).
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    /// Camera for label scanning: allowed for the portal, asked for anything else.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(Config.inAppHosts.contains(origin.host.lowercased()) ? .grant : .prompt)
    }
}

// MARK: - Download messages

extension PortalViewController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Config.downloadHandler else { return }
        handleDownload(message)
    }
}

/// WKUserContentController keeps a strong reference to its handlers; this
/// breaks the cycle between the controller and the web view it owns.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
