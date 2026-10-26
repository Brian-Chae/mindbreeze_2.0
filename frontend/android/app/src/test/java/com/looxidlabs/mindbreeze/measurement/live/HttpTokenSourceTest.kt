package com.looxidlabs.mindbreeze.measurement.live

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class MemStore(var at: String? = "old-at", var rt: String? = "rt-1") : TokenStore {
    override fun accessToken() = at
    override fun refreshToken() = rt
    override fun save(access: String?, refresh: String?) { at = access; rt = refresh }
    override fun clear() { at = null; rt = null }
}

class HttpTokenSourceTest {
    private var server: MockWebServer? = null
    private val hits = AtomicInteger()
    private val bodies = ArrayList<String>()

    private fun serve(status: Int, body: String, delayMs: Long = 0, rotate: String? = null): String {
        val s = MockWebServer()
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                hits.incrementAndGet()
                synchronized(bodies) { bodies += request.body.readUtf8() }
                val r = MockResponse().setResponseCode(status).setBody(body).setBodyDelay(delayMs, TimeUnit.MILLISECONDS)
                if (rotate != null) r.addHeader("X-MB-Refresh-Token", rotate)
                return r
            }
        }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }

    @After fun stop() { server?.shutdown() }

    @Test fun concurrentRefreshesCollapseIntoOneRequestAndShareResult() {
        val base = serve(200, """{"access_token":"new-at"}""", delayMs = 300, rotate = "rt-2")
        val store = MemStore()
        val src = HttpTokenSource(base, store)
        val pool = Executors.newFixedThreadPool(6); val start = CountDownLatch(1)
        val results = (1..6).map { pool.submit<RefreshOutcome> { start.await(); src.refresh() } }
        start.countDown()
        val outs = results.map { it.get() }
        assertEquals("single-flight", 1, hits.get())
        assertTrue(outs.all { it is RefreshOutcome.Ok && it.token == "new-at" })
        assertEquals("new-at", store.at); assertEquals("refresh 토큰 회전 반영", "rt-2", store.rt)
        assertTrue(bodies.single().contains("rt-1"))
        pool.shutdown()
    }

    @Test fun clientErrorMeansInvalidAndClearsStore() {
        val store = MemStore()
        val src = HttpTokenSource(serve(401, """{"detail":"expired"}"""), store)
        assertSame(RefreshOutcome.Invalid, src.refresh())
        assertNull(store.at); assertNull(store.rt)
    }

    @Test fun serverErrorIsTransientAndKeepsSession() {
        val store = MemStore()
        val src = HttpTokenSource(serve(503, "{}"), store)
        assertSame(RefreshOutcome.Transient, src.refresh())
        assertEquals("rt-1", store.rt); assertEquals("old-at", store.at)
    }

    @Test fun okWithoutTokenIsNotSessionRevocation() {
        val store = MemStore()
        val src = HttpTokenSource(serve(200, "{}"), store)
        assertSame(RefreshOutcome.Transient, src.refresh())
        assertEquals("rt-1", store.rt)
    }

    @Test fun networkFailureIsTransient() {
        val store = MemStore()
        val src = HttpTokenSource("http://127.0.0.1:1/api/v1", store)
        assertSame(RefreshOutcome.Transient, src.refresh())
    }

    @Test fun missingRefreshTokenIsInvalidWithoutNetwork() {
        val src = HttpTokenSource(serve(200, """{"access_token":"x"}"""), MemStore(rt = null))
        assertSame(RefreshOutcome.Invalid, src.refresh())
        assertEquals(0, hits.get())
    }
}
