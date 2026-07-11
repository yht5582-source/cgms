import Foundation

struct GlucoseReading: Identifiable, Codable, Hashable {
    let id = UUID()
    let timestamp: Date
    let glucoseMgDl: Double
    let sourceRow: Int
}

struct AGPMetrics: Codable, Equatable {
    var activeDays: Int = 0
    var capturePercent: Double = 0
    var totalReadings: Int = 0
    var averageGlucose: Double = 0
    var gmi: Double = 0
    var tir70to180: Double = 0
    var tbrBelow70: Double = 0
    var tbrBelow54: Double = 0
    var tarAbove180: Double = 0
    var tarAbove250: Double = 0
    var cv: Double = 0
    var hourlySummary: [HourlySummary] = []
}

struct HourlySummary: Codable, Equatable, Identifiable {
    var id: Int { hour }
    let hour: Int
    let median: Double?
    let p10: Double?
    let p25: Double?
    let p75: Double?
    let p90: Double?
}

struct PatternFlags: Codable, Equatable {
    var nocturnalLow = false
    var fastingLow = false
    var fastingHigh = false
    var postBreakfastSpike = false
    var postLunchSpike = false
    var postDinnerSpike = false
    var lateEveningHyperglycemia = false
}

struct TreatmentProfile: Codable, Equatable {
    var diabetesType = "type 2 diabetes"
    var kidneyContext = ""
    var therapies: Set<TherapyOption> = []
    var therapyNotes = ""
    var lifestyleNotes = ""
    var breakfast = DateComponents(hour: 7, minute: 30)
    var lunch = DateComponents(hour: 12, minute: 0)
    var dinner = DateComponents(hour: 18, minute: 0)
}

enum TherapyOption: String, CaseIterable, Codable, Identifiable {
    case basalInsulin = "basal insulin"
    case prandialInsulin = "prandial insulin"
    case sulfonylurea = "sulfonylurea"
    case glp1ra = "GLP-1 RA"
    case sglt2i = "SGLT2 inhibitor"
    case dpp4i = "DPP-4 inhibitor"

    var id: String { rawValue }
}

struct AGPAnalysis: Codable, Equatable {
    var validityStatus = "limited"
    var validityReasons: [String] = []
    var priority = "尚未分析"
    var safetyAlerts: [String] = []
    var possibleCauses: [String] = []
    var dietKeyPoints: [String] = []
    var treatmentSuggestions: [String] = []
    var reportText = ""
}

enum AGPSection: String, CaseIterable, Identifiable {
    case importData
    case summary
    case diet
    case treatment

    var id: String { rawValue }

    var title: String {
        switch self {
        case .importData: "匯入 CGMS"
        case .summary: "AGP 摘要"
        case .diet: "飲食重點"
        case .treatment: "治療建議"
        }
    }
}

struct AGPReportSummary: Codable, Identifiable, Hashable {
    let id: UUID
    let createdAt: Date
    let dateRange: String
    let tir: Double
    let tbr: Double
    let tar: Double
    let cv: Double
    let priority: String
}
