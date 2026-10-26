package com.looxidlabs.mindbreeze.measurement.runtime

import org.json.JSONObject

/** 서버가 capture stream 을 끝냈을 때(device.changed status/cutoff_code)의 bridge 상태 매핑과 live:device 보고 입력. */
object StreamLifecycle {
    private val CONTACT = setOf("contact", "leadoff", "unknown")

    /**
     * 계약 BlockedReason 으로 매핑. 정상 종료(ended/closed)는 BLOCKED 가 아니라 봉인 후 CLOSED.
     *  superseded → owner_fenced(다른 owner 가 이어받음), revoked + 동의 철회 → consent_missing, 그 밖의 revoked(추방 등) → capture_lease_denied.
     */
    fun blockedReason(status: String, cutoffCode: String?): String? = when (status) {
        "superseded" -> "owner_fenced"
        "revoked" -> if (cutoffCode?.contains("consent") == true) "consent_missing" else "capture_lease_denied"
        else -> null
    }

    /** 마지막 코어 프레임의 접촉 상태(계약 ContactState 밖 값·부재는 unknown). SQI 로 합성하지 않는다. */
    fun contactOf(frame: JSONObject?): JSONObject {
        val c = frame?.optJSONObject("contact")
        fun v(k: String) = c?.optString(k)?.takeIf { it in CONTACT } ?: "unknown"
        return JSONObject().put("fp1", v("fp1")).put("fp2", v("fp2"))
    }
}

/** live:device 는 상태가 바뀔 때(밴드 상태·접촉)와 keepalive 주기마다만 보낸다 — SQI 는 매 프레임 변해 변화 기준에서 뺀다. */
class DeviceReportPolicy(private val keepaliveMs: Long = 30_000) {
    private var lastKey: String? = null
    private var lastAtMs = Long.MIN_VALUE

    fun shouldReport(nowMs: Long, bandState: String, contact: JSONObject): Boolean {
        val key = bandState + "|" + contact.optString("fp1") + "|" + contact.optString("fp2")
        if (key == lastKey && lastAtMs != Long.MIN_VALUE && nowMs - lastAtMs < keepaliveMs) return false
        lastKey = key; lastAtMs = nowMs
        return true
    }
}
