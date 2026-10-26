import Foundation

public enum SocketIOCodecError: Error, Equatable { case malformed(String) }

public struct SocketIOPacket {
    public enum Kind: Equatable { case connect, disconnect, event, ack, connectError }
    public var kind: Kind
    public var namespace: String
    public var id: Int?
    public var name: String = ""
    public var args: [Any] = []
    public var errorMessage: String?
    public var connectPayload: [String: Any]?

    public static func connect(namespace: String, payload: [String: Any]?) -> SocketIOPacket {
        SocketIOPacket(kind: .connect, namespace: namespace, id: nil, connectPayload: payload)
    }
    public static func event(namespace: String, id: Int?, name: String, args: [Any]) -> SocketIOPacket {
        SocketIOPacket(kind: .event, namespace: namespace, id: id, name: name, args: args)
    }
    public static func ack(namespace: String, id: Int, args: [Any]) -> SocketIOPacket {
        SocketIOPacket(kind: .ack, namespace: namespace, id: id, args: args)
    }
}

/// Socket.IO v4 (EIO=4) 텍스트 패킷 코덱. 바이너리 첨부(5/6)는 지원하지 않는다 — wire 계약은 JSON 뿐이다.
public enum SocketIOCodec {
    private static func json(_ v: Any) -> String {
        guard JSONSerialization.isValidJSONObject([v]),
              let d = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed, .sortedKeys]),
              let s = String(data: d, encoding: .utf8) else { return "null" }
        return s
    }
    private static func nsPrefix(_ ns: String) -> String { ns == "/" ? "" : "\(ns)," }

    public static func encode(_ p: SocketIOPacket) -> String {
        switch p.kind {
        case .connect:
            return "40" + nsPrefix(p.namespace) + (p.connectPayload.map { json($0) } ?? "")
        case .disconnect:
            return "41" + nsPrefix(p.namespace)
        case .event:
            return "42" + nsPrefix(p.namespace) + (p.id.map(String.init) ?? "") + json([p.name] + p.args)
        case .ack:
            return "43" + nsPrefix(p.namespace) + String(p.id ?? 0) + json(p.args)
        case .connectError:
            return "44" + nsPrefix(p.namespace) + json(["message": p.errorMessage ?? ""])
        }
    }

    public static func decode(_ text: String) throws -> SocketIOPacket {
        let chars = Array(text.unicodeScalars)
        guard chars.count >= 2, chars[0] == "4" else { throw SocketIOCodecError.malformed("not a socket.io message") }
        let kindCh = chars[1]
        var i = 2
        var ns = "/"
        if i < chars.count, chars[i] == "/" {
            var j = i
            while j < chars.count, chars[j] != "," { j += 1 }
            ns = String(String.UnicodeScalarView(chars[i..<j]))
            i = min(j + 1, chars.count)
        }
        var idDigits = ""
        while i < chars.count, ("0"..."9").contains(chars[i]) { idDigits.unicodeScalars.append(chars[i]); i += 1 }
        let id = idDigits.isEmpty ? nil : Int(idDigits)
        let rest = String(String.UnicodeScalarView(chars[i...]))
        func parse() throws -> Any? {
            if rest.isEmpty { return nil }
            guard let d = rest.data(using: .utf8), let v = try? JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed]) else {
                throw SocketIOCodecError.malformed("bad json")
            }
            return v
        }
        switch kindCh {
        case "0":
            var p = SocketIOPacket(kind: .connect, namespace: ns, id: nil)
            p.connectPayload = try parse() as? [String: Any]
            return p
        case "1": return SocketIOPacket(kind: .disconnect, namespace: ns, id: nil)
        case "2":
            guard let arr = try parse() as? [Any], let name = arr.first as? String else { throw SocketIOCodecError.malformed("event name") }
            return SocketIOPacket(kind: .event, namespace: ns, id: id, name: name, args: Array(arr.dropFirst()))
        case "3":
            guard let id = id, let arr = try parse() as? [Any] else { throw SocketIOCodecError.malformed("ack") }
            return SocketIOPacket(kind: .ack, namespace: ns, id: id, args: arr)
        case "4":
            var p = SocketIOPacket(kind: .connectError, namespace: ns, id: nil)
            if let o = try parse() as? [String: Any] { p.errorMessage = (o["message"] as? String) ?? "connect_error" }
            else if let s = try parse() as? String { p.errorMessage = s } else { p.errorMessage = "connect_error" }
            return p
        default: throw SocketIOCodecError.malformed("unsupported packet type \(kindCh)")
        }
    }
}
