import SwiftUI

@main
struct LightCastRemoteApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
                .statusBarHidden(false)
        }
    }
}
