package com.looxidlabs.mindbreeze.audiorecorder

import com.looxidlabs.mindbreeze.measurement.live.HttpTokenSource
import com.looxidlabs.mindbreeze.measurement.live.MemStore
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ChunkUploaderTest {
    @get:Rule val tmp = TemporaryFolder()
    private var server: MockWebServer? = null
    private val seen = ArrayList<RecordedRequest>()

    @After fun stop() { server?.shutdown() }

    private fun serve(chunk: (RecordedRequest, Int) -> Int, refresh: () -> MockResponse = { MockResponse().setResponseCode(200).setBody("""{"access_token":"new-at"}""").addHeader("X-MB-Refresh-Token", "rt-2") }): String {
        val s = MockWebServer(); var n = 0
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(seen) { seen += request }
                return if (request.path!!.endsWith("/auth/refresh")) refresh()
                else MockResponse().setResponseCode(chunk(request, ++n))
            }
        }
        s.start(); server = s
        return s.url("/api/v1").toString().trimEnd('/')
    }

    private fun item(q: ChunkQueue, idx: Int = 3): QueuedChunk {
        val t = q.tempFile("sess-1", idx); t.writeBytes("ftypDATA".toByteArray()); q.commit("sess-1", idx, t)
        return q.pending("sess-1").single()
    }

    @Test fun uploadsMultipartToExistingChunkApi() {
        val base = serve({ _, _ -> 200 })
        val q = ChunkQueue(tmp.root); val it = item(q)
        val up = ChunkUploader(base, HttpTokenSource(base, MemStore()), OkHttpClient())
        assertEquals(UploadOutcome.Ok, up.upload(it))
        val r = seen.single()
        assertEquals("/api/v1/sessions/sess-1/audio/chunk", r.path)
        assertEquals("Bearer old-at", r.getHeader("Authorization"))
        val body = r.body.readUtf8()
        assertTrue(body.contains("name=\"chunk_index\"") && body.contains("\r\n\r\n3\r\n"))
        assertTrue(body.contains("filename=\"chunk-3.m4a\""))
        assertTrue(body.contains("Content-Type: audio/mp4"))
    }

    @Test fun refreshesOn401AndRetriesOnceWithNewToken() {
        val base = serve({ req, n -> if (n == 1) 401 else { assertEquals("Bearer new-at", req.getHeader("Authorization")); 200 } })
        val store = MemStore(); val q = ChunkQueue(tmp.root)
        val up = ChunkUploader(base, HttpTokenSource(base, store), OkHttpClient())
        assertEquals(UploadOutcome.Ok, up.upload(item(q)))
        assertEquals("rt-2", store.rt)
        val refresh = seen.first { it.path!!.endsWith("/auth/refresh") }
        assertEquals("capacitor", refresh.getHeader("X-MB-Native")); assertTrue(refresh.body.readUtf8().contains("rt-1"))
    }

    @Test fun invalidRefreshMeansAuthExpiredAndKeepsFile() {
        val base = serve({ _, _ -> 401 }, { MockResponse().setResponseCode(401) })
        val q = ChunkQueue(tmp.root); val it = item(q)
        val up = ChunkUploader(base, HttpTokenSource(base, MemStore()), OkHttpClient())
        assertEquals(UploadOutcome.AuthExpired, up.upload(it))
        assertTrue(it.file.exists())
    }

    @Test fun serverErrorAndSecond401AreRetryAndKeepFile() {
        val base = serve({ _, _ -> 500 })
        val q = ChunkQueue(tmp.root); val it = item(q)
        val up = ChunkUploader(base, HttpTokenSource(base, MemStore()), OkHttpClient())
        assertEquals(UploadOutcome.Retry, up.upload(it)); assertTrue(it.file.exists())
        val base2 = serve({ _, _ -> 401 })
        val up2 = ChunkUploader(base2, HttpTokenSource(base2, MemStore()), OkHttpClient())
        assertEquals(UploadOutcome.Retry, up2.upload(it))
    }

    @Test fun networkFailureIsRetry() {
        val base = serve({ _, _ -> 200 }); server!!.shutdown()
        val q = ChunkQueue(tmp.root)
        val up = ChunkUploader(base, HttpTokenSource(base, MemStore()), OkHttpClient())
        assertEquals(UploadOutcome.Retry, up.upload(item(q)))
    }
}
