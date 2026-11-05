package com.looxidlabs.mindbreeze.auth

import com.looxidlabs.mindbreeze.measurement.live.HttpTokenSource
import com.looxidlabs.mindbreeze.measurement.live.MemStore
import com.looxidlabs.mindbreeze.measurement.live.RefreshOutcome
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** SDD-305 B: 계정별 단일 인증 조정자 — B1(동시 401 → HTTP 1회) B2(세대) B3(로그아웃·계정 전환) B4(재시작). */
class NativeAuthCoordinatorTest {
    private var server: MockWebServer? = null
    private val hits = AtomicInteger()
    private val seenBodies = ArrayList<String>()
    private val http = OkHttpClient()

    private fun jwt(sub: String, exp: Long): String {
        val enc = java.util.Base64.getUrlEncoder().withoutPadding()
        return enc.encodeToString("""{"alg":"none"}""".toByteArray()) + "." +
            enc.encodeToString("""{"sub":"$sub","exp":$exp}""".toByteArray()) + ".sig"
    }

    private fun serve(delayMs: Long = 0, next: (Int) -> Triple<Int, String, String?>): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val n = hits.incrementAndGet()
                synchronized(seenBodies) { seenBodies += request.body.readUtf8() }
                val (code, body, rotate) = next(n)
                val r = MockResponse().setResponseCode(code).setBody(body).setBodyDelay(delayMs, TimeUnit.MILLISECONDS)
                if (rotate != null) r.addHeader("X-MB-Refresh-Token", rotate)
                return r
            }
        }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }

    @Before fun reset() { NativeAuthCoordinator.resetForTests() }
    @After fun stop() { server?.shutdown() }

    /** 같은 저장소 객체를 가리키는 서로 다른 소비자(Runtime·Sweeper·오디오·WebView)를 흉내 낸다. */
    private class SharedKeyStore(private val inner: MemStore, override val scopeKey: String) : com.looxidlabs.mindbreeze.measurement.live.TokenStore by inner

    @Test fun b1_runtimeSweeperAudioConcurrent401_oneRefreshHttp_sharedResult() {
        val base = serve(delayMs = 300) { Triple(200, """{"access_token":"${jwt("u1", 9999)}"}""", "rt-2") }
        val mem = MemStore(at = jwt("u1", 10), rt = "rt-1")
        val consumers = (1..4).map { HttpTokenSource(base, SharedKeyStore(mem, "same-file")) }
        consumers.forEach { it.current() } // 모두 같은 세대에서 401 을 맞았다
        val pool = Executors.newFixedThreadPool(4); val go = CountDownLatch(1)
        val outs = consumers.map { c -> pool.submit<RefreshOutcome> { go.await(); c.refresh() } }
        go.countDown()
        val results = outs.map { it.get() }
        assertEquals("refresh HTTP 1회", 1, hits.get())
        assertTrue(results.all { it is RefreshOutcome.Ok })
        assertEquals(1, results.map { (it as RefreshOutcome.Ok).token }.toSet().size)
        assertEquals("rt-2", mem.rt)
        pool.shutdown()
    }

    @Test fun b1b_sequentialConsumersWithStaleGenerationReuseFreshAccessWithoutHttp() {
        val base = serve { Triple(200, """{"access_token":"${jwt("u1", 9999)}"}""", "rt-${it + 1}") }
        val mem = MemStore(at = jwt("u1", 10), rt = "rt-1")
        val a = HttpTokenSource(base, SharedKeyStore(mem, "k")); val b = HttpTokenSource(base, SharedKeyStore(mem, "k"))
        a.current(); b.current()          // 둘 다 세대 0 의 access 로 요청했다가 401
        assertTrue(a.refresh() is RefreshOutcome.Ok)
        assertTrue(b.refresh() is RefreshOutcome.Ok) // 이미 다른 소비자가 갱신 → HTTP 없이 최신 access
        assertEquals("두 번째 소비자는 추가 회전을 만들지 않는다", 1, hits.get())
    }

    @Test fun b2_staleResponseAfterSignOutIsDiscarded() {
        val base = serve(delayMs = 400) { Triple(200, """{"access_token":"${jwt("u1", 9999)}"}""", "rt-2") }
        val mem = MemStore(at = jwt("u1", 10), rt = "rt-1")
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k2"))
        val pool = Executors.newSingleThreadExecutor()
        val f = pool.submit<AccessResult> { c.ensureAccess(base, http, "u1", true, null) }
        Thread.sleep(100)
        c.signOut() // 로그아웃이 진행 중 갱신보다 나중
        f.get()
        assertNull("늦은 응답이 로그아웃 뒤 저장소를 되살리지 않는다", mem.at)
        assertNull(mem.rt)
        pool.shutdown()
    }

    @Test fun b3_accountMismatchNeverUsesOtherAccountsCredentials() {
        val base = serve { Triple(200, """{"access_token":"x"}""", null) }
        val mem = MemStore(at = jwt("u1", 9999), rt = "rt-1")
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k3"))
        assertEquals(AccessResult.AccountMismatch, c.ensureAccess(base, http, "u2", false, null))
        assertEquals(AccessResult.AccountMismatch, c.ensureAccess(base, http, "u2", true, null))
        assertEquals("다른 계정 요청에는 HTTP 도 나가지 않는다", 0, hits.get())
    }

    @Test fun b3b_adoptNeverGoesBackwardsForSameAccount() {
        val mem = MemStore(at = jwt("u1", 2000), rt = "rt-new")
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k4"))
        val r = c.adoptIfNewer(jwt("u1", 1000), "rt-old") // 오래된 JS 복사본
        assertFalse(r.adopted)
        assertEquals("rt-new", mem.rt)
        val r2 = c.adoptIfNewer(jwt("u2", 100), "rt-other") // 계정 전환 → 교체
        assertTrue(r2.adopted)
        assertEquals("rt-other", mem.rt)
    }

    @Test fun b3c_adoptAccessOnlyKeepsStoredRefreshForSameAccount() {
        val mem = MemStore(at = jwt("u1", 1000), rt = "rt-keep")
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k5"))
        assertTrue(c.adoptIfNewer(jwt("u1", 5000), null).adopted)
        assertEquals("rt-keep", mem.rt)
    }

    @Test fun b4_restartRecoversFromStoreAndRefreshes() {
        val base = serve { Triple(200, """{"access_token":"${jwt("u1", 9999)}"}""", "rt-2") }
        val mem = MemStore(at = jwt("u1", 10), rt = "rt-1")
        NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k6"))
        NativeAuthCoordinator.resetForTests() // 프로세스 재시작 = 메모리 상태 소멸, 저장소만 남음
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k6"))
        assertTrue(c.ensureAccess(base, http, "u1", true, null) is AccessResult.Ok)
        assertTrue(seenBodies.single().contains("rt-1"))
        assertEquals("rt-2", mem.rt)
    }

    @Test fun invalidClearsStoreButTransientKeepsIt() {
        val base = serve { n -> if (n == 1) Triple(503, "", null) else Triple(401, "", null) }
        val mem = MemStore(at = jwt("u1", 10), rt = "rt-1")
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(mem, "k7"))
        assertEquals(AccessResult.Transient, c.ensureAccess(base, http, null, true, null))
        assertEquals("rt-1", mem.rt)
        assertEquals(AccessResult.Invalid, c.ensureAccess(base, http, null, true, null))
        assertNull(mem.rt)
    }

    @Test fun keystoreWriteFailureDoesNotLoseRotatedPair() {
        val base = serve { n -> Triple(200, """{"access_token":"${jwt("u1", 9000L + n)}"}""", "rt-${n + 1}") }
        val inner = MemStore(at = jwt("u1", 10), rt = "rt-1")
        var failSave = true
        val flaky = object : com.looxidlabs.mindbreeze.measurement.live.TokenStore by inner {
            override val scopeKey = "k8"
            override fun save(access: String?, refresh: String?) { if (failSave) throw IllegalStateException("keystore") else inner.save(access, refresh) }
        }
        val c = NativeAuthCoordinator.forStore(flaky)
        assertTrue(c.ensureAccess(base, http, null, true, null) is AccessResult.Ok)
        failSave = false
        assertTrue(c.ensureAccess(base, http, null, true, null) is AccessResult.Ok) // 메모리에 남은 새 쌍으로 다음 회전 (옛 rt-1 재사용 금지)
        assertTrue("두 번째 요청은 서버가 회전해 준 rt-2 를 보냈다", seenBodies[1].contains("rt-2"))
    }

    @Test fun noCredentialsAndMissingRefreshAreReported() {
        val base = serve { Triple(200, "{}", null) }
        val c = NativeAuthCoordinator.forStore(SharedKeyStore(MemStore(at = null, rt = null), "k9"))
        assertEquals(AccessResult.NoCredentials, c.ensureAccess(base, http, null, false, null))
        val c2 = NativeAuthCoordinator.forStore(SharedKeyStore(MemStore(at = jwt("u1", 1), rt = null), "k10"))
        assertEquals(AccessResult.Invalid, c2.ensureAccess(base, http, null, true, null))
        assertEquals(0, hits.get())
    }
}
