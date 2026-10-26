package com.looxidlabs.mindbreeze.measurement.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** 서버가 stream 을 끝냈을 때의 bridge 상태 매핑과 live:device 보고 주기(T08d). */
class StreamLifecycleTest {
    @Test fun streamEndMapsToContractBlockedReason() {
        assertEquals("owner_fenced", StreamLifecycle.blockedReason("superseded", null))
        assertEquals("consent_missing", StreamLifecycle.blockedReason("revoked", "consent_withdrawn"))
        assertEquals("capture_lease_denied", StreamLifecycle.blockedReason("revoked", "expelled"))
        assertNull("정상 종료는 BLOCKED 가 아님", StreamLifecycle.blockedReason("ended", "session_ended"))
        assertNull(StreamLifecycle.blockedReason("closed", null))
        // 계약 BlockedReason enum 안의 값만
        val allowed = setOf("bluetooth_permission", "bluetooth_off", "storage_full", "consent_missing", "capture_lease_denied", "auth_expired", "account_mismatch", "owner_fenced", "unsupported_background")
        for (s in listOf("superseded", "revoked", "ended", "closed", "weird")) for (c in listOf(null, "consent_withdrawn", "x"))
            StreamLifecycle.blockedReason(s, c)?.let { assertTrue(it, it in allowed) }
    }

    @Test fun deviceReportOnChangeOrEvery30s() {
        val r = DeviceReportPolicy(keepaliveMs = 30_000)
        val c1 = JSONObject("""{"fp1":"contact","fp2":"contact"}"""); val c2 = JSONObject("""{"fp1":"contact","fp2":"leadoff"}""")
        assertTrue("첫 보고", r.shouldReport(0, "connected", c1))
        assertFalse(r.shouldReport(1_000, "connected", JSONObject(c1.toString())))
        assertTrue("접촉 변화", r.shouldReport(2_000, "connected", c2))
        assertTrue("밴드 상태 변화", r.shouldReport(3_000, "reconnecting", c2))
        assertFalse(r.shouldReport(32_999, "reconnecting", c2))
        assertTrue("30초 keepalive", r.shouldReport(33_000, "reconnecting", c2))
    }

    @Test fun contactFromFrameFallsBackToUnknown() {
        assertEquals("""{"fp1":"unknown","fp2":"unknown"}""", StreamLifecycle.contactOf(null).toString())
        assertEquals("leadoff", StreamLifecycle.contactOf(JSONObject("""{"contact":{"fp1":"leadoff","fp2":"contact"}}""")).getString("fp1"))
        assertEquals("형식 밖 값은 unknown", "unknown", StreamLifecycle.contactOf(JSONObject("""{"contact":{"fp1":"synth","fp2":"contact"}}""")).getString("fp1"))
    }
}
