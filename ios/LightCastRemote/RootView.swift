import SwiftUI

struct RootView: View {
    @State private var server = Config.server
    @State private var failure: String?
    @State private var reload = 0
    @State private var showSettings = false
    private let background = Color(red: 0.075, green: 0.086, blue: 0.118)

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            if let url = Config.remoteURL(server) {
                RemoteWebView(url: url, reload: reload, failure: $failure, onSettings: { showSettings = true })
                    .ignoresSafeArea()
            }
            if let failure {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark").font(.system(size: 44))
                    Text("리모컨에 연결하지 못했습니다").font(.title3.bold())
                    Text(failure).font(.callout).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    Button("다시 시도") { self.failure = nil; reload += 1 }.buttonStyle(.borderedProminent)
                    Button("서버 주소 변경") { showSettings = true }
                }
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(background)
            }
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .sheet(isPresented: $showSettings) {
            SettingsView(server: $server) { failure = nil; reload += 1 }
        }
    }
}
