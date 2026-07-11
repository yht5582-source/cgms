import SwiftUI

@main
struct CGMSNativeApp: App {
    @StateObject private var store = CGMSStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .onAppear {
                    if let pending = IntentHandoffStore.consumePendingSection() {
                        store.route = pending
                    }
                }
                .onChange(of: scenePhase) {
                    if let pending = IntentHandoffStore.consumePendingSection() {
                        store.route = pending
                    }
                }
        }
    }
}

enum IntentHandoffStore {
    private static let key = "pending-agp-section"

    static func request(_ section: AGPSection) {
        UserDefaults.standard.set(section.rawValue, forKey: key)
    }

    static func consumePendingSection() -> AGPSection? {
        guard let raw = UserDefaults.standard.string(forKey: key), let section = AGPSection(rawValue: raw) else {
            return nil
        }
        UserDefaults.standard.removeObject(forKey: key)
        return section
    }
}
