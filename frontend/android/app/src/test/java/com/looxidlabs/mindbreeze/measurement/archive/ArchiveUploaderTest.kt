package com.looxidlabs.mindbreeze.measurement.archive

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

class ArchiveClassifierTest {
    private fun d(stage: ArchiveStage, status: Int, body: String = "{}") = ArchiveClassifier.classify(stage, status, JSONObject(body), null)

    @Test fun putForbiddenMeansRepresignButApiForbiddenHalts() {
        assertEquals(ArchiveAction.REPRESIGN, d(ArchiveStage.PUT, 403).action)
        assertEquals(ArchiveAction.HALT, d(ArchiveStage.PRESIGN, 403, """{"detail":{"code":"archive_rejected","reason":"consent_withdrawn"}}""").action)
        assertEquals("consent_withdrawn", d(ArchiveStage.VERIFY, 403, """{"detail":{"code":"archive_rejected","reason":"consent_withdrawn"}}""").code)
    }

    @Test fun conflictSplitsTimeReviewFromQuarantine() {
        assertEquals(ArchiveAction.TIME_REVIEW, d(ArchiveStage.PRESIGN, 409, """{"detail":{"code":"pending_time_review","reason":"window_unproven"}}""").action)
        assertEquals("window_unproven", d(ArchiveStage.PRESIGN, 409, """{"detail":{"code":"pending_time_review","reason":"window_unproven"}}""").code)
        assertEquals(ArchiveAction.QUARANTINE, d(ArchiveStage.PRESIGN, 409, """{"detail":{"code":"alias_conflict"}}""").action)
    }

    @Test fun payloadTooLargeIsSplitCandidateAndValidationQuarantines() {
        val a = d(ArchiveStage.PRESIGN, 413)
        assertEquals(ArchiveAction.QUARANTINE, a.action); assertTrue(a.splitCandidate)
        assertEquals(ArchiveAction.QUARANTINE, d(ArchiveStage.PRESIGN, 422).action)
        assertEquals(ArchiveAction.QUARANTINE, d(ArchiveStage.PRESIGN, 400).action)
    }

    @Test fun transientStatusesBackoffAndHonorRetryAfter() {
        for (s in listOf(500, 502, 503, 408, 429, 401)) assertEquals("status $s", ArchiveAction.BACKOFF, d(ArchiveStage.PRESIGN, s).action)
        val r = d(ArchiveStage.PRESIGN, 429, """{"retry_after":7}""")
        assertEquals(7000L, r.retryAfterMs)
        assertEquals(ArchiveAction.REPRESIGN, d(ArchiveStage.VERIFY, 404).action)
        assertEquals(ArchiveAction.QUARANTINE, d(ArchiveStage.PRESIGN, 404).action)
    }

    @Test fun backoffIsBoundedForAnyAttemptCount() {
        assertEquals(1000L, ArchiveClassifier.backoffMs(0, null))
        assertEquals(60_000L, ArchiveClassifier.backoffMs(500, null))
        assertEquals(90_000L, ArchiveClassifier.backoffMs(500, 90_000))
    }
}

class ArchiveUploaderTest {
    @get:Rule val tmp = TemporaryFolder()
    private var server: MockWebServer? = null
    private val log = java.util.Collections.synchronizedList(ArrayList<String>())
    private val presignBodies = java.util.Collections.synchronizedList(ArrayList<JSONObject>())
    private lateinit var script: (RecordedRequest) -> MockResponse
    private var now = 1_000_000L

    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

    private fun start(): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() { override fun dispatch(request: RecordedRequest) = script(request) }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }
    @After fun stop() { server?.shutdown() }

    private fun queue(): ArchiveQueue = ArchiveQueue(File(tmp.root, "q"), nowMs = { now })

    private fun enqueue(q: ArchiveQueue, alias: String = "art-1", kind: String = "feature", payload: ByteArray = "hello-payload".toByteArray(), withRange: Boolean = true): ArchiveItem {
        val meta = JSONObject().put("artifact_alias", alias).put("artifact_kind", kind).put("checksum", sha(payload)).put("size_bytes", payload.size)
        if (withRange) meta.put("monotonic_range", JSONObject().put("from_us", "1000000").put("to_us", "2000000"))
        return q.enqueue(kind, "00000001-0000-4000-8000-000000000001", "00000002-0000-4000-8000-000000000002", alias, meta, payload)
    }

    private fun ticketJson(base: String, alias: String, payload: ByteArray, kind: String = "feature", id: String = "srv-1") =
        """{"chunks":[{"${if (kind == "raw") "chunk_alias" else "artifact_alias"}":"$alias","${if (kind == "raw") "chunk_id" else "artifact_id"}":"$id","checksum":"${sha(payload)}","size_bytes":${payload.size},"upload_url":"$base/put/$id","upload_headers":{"x-amz-meta":"1"},"upload_status":"pending"}]}"""

    private fun happy(payload: ByteArray, alias: String = "art-1"): (RecordedRequest) -> MockResponse = { r ->
        val base = "http://${r.requestUrl!!.host}:${r.requestUrl!!.port}"
        log += "${r.method} ${r.path}"
        when {
            r.path!!.endsWith("/biosignal-artifacts/presign") -> { presignBodies += JSONObject(r.body.readUtf8()); MockResponse().setBody(ticketJson(base, alias, payload)) }
            r.path!!.startsWith("/put/") -> MockResponse().setResponseCode(200)
            r.path!!.endsWith("/biosignal-artifacts/ack") -> MockResponse().setBody("""{"chunks":[{"artifact_id":"srv-1","artifact_alias":"$alias","checksum":"${sha(payload)}","size_bytes":${payload.size},"upload_status":"uploaded","verified_at_us":"123","failure_reason":null}]}""")
            else -> MockResponse().setResponseCode(404)
        }
    }

    private fun uploader(base: String, q: ArchiveQueue, streamId: String? = "00000014-0000-4000-8000-000000000014") =
        ArchiveUploader(base, q, tokenProvider = { "access-tok" }, http = OkHttpClient(), captureStreamId = { streamId }, nowMs = { now })

    @Test fun uploadsPresignPutAckAndSendsCaptureStreamAndMonotonicRange() {
        val payload = "hello-payload".toByteArray(); script = happy(payload)
        val base = start(); val q = queue(); val item = enqueue(q)
        val sum = uploader(base, q).drain()
        assertEquals(1, sum.acked)
        assertEquals(listOf("POST /api/v1/sessions/00000001-0000-4000-8000-000000000001/biosignal-artifacts/presign", "PUT /put/srv-1",
            "POST /api/v1/sessions/00000001-0000-4000-8000-000000000001/biosignal-artifacts/ack"), log.toList())
        val body = presignBodies.single()
        assertEquals("00000014-0000-4000-8000-000000000014", body.getString("capture_stream_id"))
        assertEquals("2000000", body.getJSONArray("chunks").getJSONObject(0).getJSONObject("monotonic_range").getString("to_us"))
        assertEquals(ArchiveStatus.VERIFIED, q.get(item.id)!!.status)
        assertEquals("123", q.get(item.id)!!.verifiedAtUs)
    }

    @Test fun legacyBodyWhenNoCaptureStream() {
        val payload = "hello-payload".toByteArray(); script = happy(payload)
        val base = start(); val q = queue(); enqueue(q)
        uploader(base, q, streamId = null).drain()
        assertFalse(presignBodies.single().has("capture_stream_id"))
    }

    @Test fun putSignatureExpiryRepresignsWithinSameCallThenSucceeds() {
        val payload = "hello-payload".toByteArray(); var puts = 0
        val happyS = happy(payload)
        script = { r -> if (r.path!!.startsWith("/put/") && puts++ == 0) { log += "PUT-403"; MockResponse().setResponseCode(403) } else happyS(r) }
        val base = start(); val q = queue(); val item = enqueue(q)
        val sum = uploader(base, q).drain()
        assertEquals(1, sum.acked)
        assertEquals(2, presignBodies.size)
        assertEquals(ArchiveStatus.VERIFIED, q.get(item.id)!!.status)
    }

    @Test fun apiForbiddenHaltsQueueAndKeepsItemsWithReason() {
        val payload = "x".toByteArray()
        script = { MockResponse().setResponseCode(403).setBody("""{"detail":{"code":"archive_rejected","reason":"after_cutoff"}}""") }
        val base = start(); val q = queue(); val a = enqueue(q, "a"); val b = enqueue(q, "b")
        val sum = uploader(base, q).drain()
        assertEquals("after_cutoff", sum.halted)
        assertEquals(0, sum.acked)
        assertEquals("halt 후 두 번째 항목은 시도하지 않음", 1, log.size.coerceAtLeast(1))
        assertEquals(ArchiveStatus.HALTED, q.get(a.id)!!.status); assertEquals("after_cutoff", q.get(a.id)!!.lastReason)
        assertEquals(ArchiveStatus.PENDING, q.get(b.id)!!.status)
        assertNotNull(q.get(a.id)!!.payloadFile.takeIf { it.exists() })
    }

    @Test fun backoffNeverBecomesPermanentFailureAndRespectsNextAttempt() {
        val payload = "hello-payload".toByteArray()
        script = { MockResponse().setResponseCode(503) }
        val base = start(); val q = queue(); val item = enqueue(q)
        val up = uploader(base, q)
        repeat(30) { up.drain(); now += 120_000 }
        val it1 = q.get(item.id)!!
        assertEquals(ArchiveStatus.PENDING, it1.status)
        assertEquals(30, it1.attempts)
        // 바로 다시 호출하면 nextAttempt 전이라 서버를 때리지 않는다
        val before = server!!.requestCount; up.drain(); up.drain()
        assertEquals(before + 1, server!!.requestCount.also { }) // 마지막 drain 한 번만 시도(now 는 이미 지남)
    }

    @Test fun pendingTimeReviewConflictIsHeldNotCompleted() {
        script = { MockResponse().setResponseCode(409).setBody("""{"detail":{"code":"pending_time_review","reason":"window_unproven"}}""") }
        val base = start(); val q = queue(); val item = enqueue(q)
        val sum = uploader(base, q).drain()
        assertEquals(1, sum.timeReview); assertEquals(0, sum.acked)
        assertEquals(ArchiveStatus.TIME_REVIEW, q.get(item.id)!!.status)
        assertEquals(1, q.counts().pendingTimeReview)
    }

    @Test fun validationErrorQuarantinesToDeadLetterButKeepsPayload() {
        script = { MockResponse().setResponseCode(422).setBody("""{"detail":{"code":"content_schema_invalid"}}""") }
        val base = start(); val q = queue(); val item = enqueue(q)
        uploader(base, q).drain()
        val s = q.get(item.id)!!
        assertEquals(ArchiveStatus.DEAD_LETTER, s.status); assertEquals("content_schema_invalid", s.lastReason)
        assertTrue(s.payloadFile.exists())
    }

    @Test fun ackLostThenReplayConvergesToVerified() {
        val payload = "hello-payload".toByteArray(); var acks = 0
        val happyS = happy(payload)
        script = { r -> if (r.path!!.endsWith("/ack") && acks++ == 0) MockResponse().setResponseCode(503) else happyS(r) }
        val base = start(); val q = queue(); val item = enqueue(q)
        val up = uploader(base, q)
        up.drain(); assertEquals(ArchiveStatus.PENDING, q.get(item.id)!!.status)
        now += 5_000; up.drain()
        assertEquals(ArchiveStatus.VERIFIED, q.get(item.id)!!.status)
    }

    @Test fun localSealMismatchIsNotUploaded() {
        val payload = "hello-payload".toByteArray(); script = happy(payload)
        val base = start(); val q = queue(); val item = enqueue(q)
        item.payloadFile.writeBytes("tampered!!".toByteArray())
        uploader(base, q).drain()
        assertEquals(0, server!!.requestCount)
        assertEquals(ArchiveStatus.DEAD_LETTER, q.get(item.id)!!.status); assertEquals("local_seal_mismatch", q.get(item.id)!!.lastReason)
    }

    @Test fun queueSurvivesRestartAndKeepsOrder() {
        val q1 = queue(); val a = enqueue(q1, "a"); enqueue(q1, "b")
        val q2 = ArchiveQueue(File(tmp.root, "q"), nowMs = { now })
        assertEquals(listOf("a", "b"), q2.pending().map { it.alias })
        assertEquals(a.id, q2.pending().first().id)
        assertEquals(2, q2.counts().archivePending)
    }

    @Test fun unauthorizedAccountItemsAreNotUploadedWhenTokenMissing() {
        val payload = "x".toByteArray(); script = happy(payload)
        val base = start(); val q = queue(); val item = enqueue(q)
        val sum = ArchiveUploader(base, q, tokenProvider = { null }, http = OkHttpClient(), captureStreamId = { null }, nowMs = { now }).drain()
        assertEquals(0, server!!.requestCount)
        assertEquals("auth_missing", sum.halted)
        assertEquals(ArchiveStatus.PENDING, q.get(item.id)!!.status)
    }
}
