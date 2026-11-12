import Foundation

/// Where the remote lives: the church Worker that serves LightCast's phone remote.
enum Config {
    static let defaultServer = "https://lyrics-ai-proxy.spencerkim1235.workers.dev"
    private static let key = "lightcast.remote.server"

    static var server: String {
        get { UserDefaults.standard.string(forKey: key) ?? defaultServer }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// "worker.example.com", "http://x" or a pasted remote link → "https://worker.example.com". nil if unusable.
    static func normalize(_ raw: String) -> String? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let parts = URLComponents(string: text), let host = parts.host, host.contains("."),
              parts.scheme == "https" else { return nil }
        let port = parts.port.map { ":\($0)" } ?? ""
        return "https://\(host)\(port)"
    }

    static func remoteURL(_ server: String) -> URL? {
        URL(string: server + "/freecast/remote/")
    }
}
