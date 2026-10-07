import Foundation

/// Number rules of the canonical JSON (contract §5).
public enum SPDFNumber {
    /// Rounds to `decimals` decimals, half to even on the exact binary value
    /// (printf is exact); -0 becomes 0.
    public static func round(_ x: Double, decimals: Int) -> Double {
        guard x.isFinite else { return x }
        let s = String(format: "%.\(decimals)f", x)
        let r = Double(s) ?? x
        return r == 0 ? 0 : r
    }

    /// Rounds to six decimals.
    public static func round6(_ x: Double) -> Double { round(x, decimals: 6) }

    /// ECMAScript Number::toString of a double (the number form of RFC 8785):
    /// `1.0` → `1`, `1e-7` → `1e-7`, `1e21` → `1e+21`.
    public static func format(_ x: Double) -> String {
        guard x.isFinite else { return "null" }
        if x == 0 { return "0" }
        let neg = x < 0
        // Swift's description is the shortest round-trip representation.
        var desc = "\(Swift.abs(x))"
        var exp = 0
        if let e = desc.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            exp = Int(desc[desc.index(after: e)...]) ?? 0
            desc = String(desc[..<e])
        }
        var intPart = desc
        var frac = ""
        if let dot = desc.firstIndex(of: ".") {
            intPart = String(desc[..<dot])
            frac = String(desc[desc.index(after: dot)...])
        }
        var digits = intPart + frac
        var pointPos = intPart.count + exp  // decimal point after this many digits
        // strip leading zeros
        while digits.count > 1, digits.first == "0" {
            digits.removeFirst()
            pointPos -= 1
        }
        // strip trailing zeros
        while digits.count > 1, digits.last == "0" { digits.removeLast() }
        let k = digits.count
        let n = pointPos
        var s: String
        if k <= n && n <= 21 {
            s = digits + String(repeating: "0", count: n - k)
        } else if 0 < n && n <= 21 {
            let idx = digits.index(digits.startIndex, offsetBy: n)
            s = String(digits[..<idx]) + "." + String(digits[idx...])
        } else if -6 < n && n <= 0 {
            s = "0." + String(repeating: "0", count: -n) + digits
        } else {
            let e = n - 1
            let es = (e > 0 ? "+" : "-") + String(Swift.abs(e))
            if k == 1 {
                s = digits + "e" + es
            } else {
                s = String(digits.first!) + "." + String(digits.dropFirst()) + "e" + es
            }
        }
        return neg ? "-" + s : s
    }
}
