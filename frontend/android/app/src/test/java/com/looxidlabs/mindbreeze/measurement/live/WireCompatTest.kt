package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** T05b 8항: Android socket.io-client 버전이 contracts wire-compat.json native_clients.android 와 같아야 한다. */
class WireCompatTest {
    private val contractDir = File(System.getProperty("mb.contract.dir") ?: "../../contracts")

    @Test fun socketIoClientVersionMatchesWireCompat() {
        val wc = File(contractDir, "session-live-v2/wire-compat.json")
        assumeTrue("contracts 필요", wc.exists())
        val android = JSONObject(wc.readText()).getJSONObject("native_clients").getJSONObject("android")
        assertEquals("websocket-only", android.getString("transport"))
        val gradle = File("build.gradle").readText()
        val dep = Regex("""implementation\s+['"]io\.socket:socket\.io-client:([^'"]+)['"]""").findAll(gradle).map { it.groupValues[1] }.toList()
        assertEquals("socket.io-client 의존은 하나", 1, dep.size)
        assertEquals("${android.getString("library")}:${android.getString("version")}", "io.socket:socket.io-client:${dep[0]}")
        assertEquals("2.1.2", dep[0])
    }

    @Test fun transportIsWebsocketOnly() {
        val src = File("src/main/java/com/looxidlabs/mindbreeze/measurement/live/IoSocketTransport.kt").readText()
        assertTrue(src.contains("transports = arrayOf(WebSocket.NAME)") || src.contains("arrayOf(\"websocket\")"))
    }
}
