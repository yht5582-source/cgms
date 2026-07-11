import AppIntents
import Foundation

enum AGPIntentSection: String, AppEnum {
    case importData
    case summary
    case diet
    case treatment

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "CGMS 區段")
    static var caseDisplayRepresentations: [AGPIntentSection: DisplayRepresentation] = [
        .importData: "匯入 CGMS",
        .summary: "AGP 摘要",
        .diet: "飲食重點",
        .treatment: "治療建議"
    ]

    var appSection: AGPSection {
        switch self {
        case .importData: .importData
        case .summary: .summary
        case .diet: .diet
        case .treatment: .treatment
        }
    }
}

struct OpenAGPInterpreterIntent: AppIntent {
    static var title: LocalizedStringResource = "開啟 CGMS 判讀"
    static var description = IntentDescription("開啟 CGMS / AGP 判讀到指定區段。")
    static var openAppWhenRun = true

    @Parameter(title: "區段", default: .summary)
    var section: AGPIntentSection

    func perform() async throws -> some IntentResult {
        IntentHandoffStore.request(section.appSection)
        return .result(dialog: "已開啟 \(section.appSection.title)")
    }
}

struct ImportCGMSFileIntent: AppIntent {
    static var title: LocalizedStringResource = "匯入 CGMS 資料"
    static var description = IntentDescription("開啟 LibreView CSV 匯入流程。")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        IntentHandoffStore.request(.importData)
        return .result(dialog: "請選擇 LibreView CSV 檔案")
    }
}

struct ShowLatestAGPSummaryIntent: AppIntent {
    static var title: LocalizedStringResource = "查看最近 AGP 摘要"
    static var description = IntentDescription("在 Shortcuts 或 Siri 顯示最近一次 CGMS / AGP 摘要。")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let data = UserDefaults.standard.data(forKey: "latest-agp-summary"),
              let summary = try? JSONDecoder().decode(AGPReportSummary.self, from: data) else {
            IntentHandoffStore.request(.importData)
            return .result(dialog: "目前沒有 AGP 摘要，請先開啟 app 匯入 LibreView CSV。")
        }

        let dialog = """
        最近 AGP：\(summary.dateRange)
        TIR \(summary.tir)%、TBR \(summary.tbr)%、TAR \(summary.tar)%、CV \(summary.cv)%。
        優先處理：\(summary.priority)
        """
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

struct AGPShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenAGPInterpreterIntent(),
            phrases: [
                "開啟 \(.applicationName) CGMS 判讀",
                "用 \(.applicationName) 看 AGP"
            ],
            shortTitle: "開啟 CGMS 判讀",
            systemImageName: "chart.xyaxis.line"
        )
        AppShortcut(
            intent: ImportCGMSFileIntent(),
            phrases: [
                "用 \(.applicationName) 匯入 CGMS 資料",
                "匯入 \(.applicationName) LibreView CSV"
            ],
            shortTitle: "匯入 CGMS",
            systemImageName: "square.and.arrow.down"
        )
        AppShortcut(
            intent: ShowLatestAGPSummaryIntent(),
            phrases: [
                "查看 \(.applicationName) 最近 AGP 摘要",
                "用 \(.applicationName) 顯示 CGMS 摘要"
            ],
            shortTitle: "最近 AGP",
            systemImageName: "doc.text.magnifyingglass"
        )
    }
}
