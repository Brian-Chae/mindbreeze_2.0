package com.looxidlabs.mindbreeze.measurement.bridge

import com.looxidlabs.mindbreeze.measurement.archive.ArchiveCounts
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** 생성한 snapshot/event 가 T01 measurement-bridge 스키마(ajv)를 통과하는지 node 검증기로 확인한다. */
class BridgeModelTest {
    @get:Rule val tmp = TemporaryFolder()
    private val contractDir = File(System.getProperty("mb.contract.dir") ?: "../../contracts")

    private fun frame() = JSONObject("""{"sequence":"41","window_start_us":"1","window_end_us":"2","observed_at_ms":1760000000000,"sqi":0.9,"contact":{"fp1":"contact","fp2":"contact"},"metrics":{"focus_display":{"value":61,"unit":"score_0_100","validity":"valid","reason":null,"last_valid_sequence":"41","last_valid_observed_at_ms":1760000000000},"bpm":{"value":null,"unit":"beats_per_min","validity":"warming_up","reason":"insufficient_window","last_valid_sequence":null,"last_valid_observed_at_ms":null}},"feature_hash":"${"a".repeat(64)}"}""")

    private fun inputs(withFrame: Boolean = true) = BridgeInputs(
        managerGeneration = 1, seq = 57, sessionId = "00000001-0000-4000-8000-000000000001", state = "CAPTURING", blockedReason = null,
        streamId = "00000014-0000-4000-8000-000000000014", ownerGeneration = "3",
        nativeRuntime = "native-1.0.0", core = "core-1.0.0", algorithm = "web-ts-1", model = "b0-cohort-2", deviceProfile = "linkband2-v1",
        lastFrame = if (withFrame) frame() else null, freshness = "fresh", bandState = "connected", lastCommittedSample = 12345,
        eegPackets = 720, ppgPackets = 720, accPackets = 720, eegSamples = 18000, ppgSamples = 3600, accSamples = 2160, metricWindows = 41, nativeHeartbeat = 120,
        socket = "ready", lastAckSequence = 41, through = JSONArray("""[{"audience":"host","domain":"metrics","seq":"41"}]"""),
        liveAcked = 41, livePending = 0, archive = ArchiveCounts(3, 10, 0, 0, 0, 4200, 1048576), lastVerifiedAtMs = 1760000000000,
        gaps = listOf(JSONObject("""{"gap_id":"00000028-0000-4000-8000-000000000028","kind":"ble_disconnect","start_sample_sequence":"5000","end_sample_sequence":"5499","bounded":true}""")),
    )

    @Test fun snapshotHasNoRawNoTokensAndU64AsStrings() {
        val s = BridgeModel.snapshot(inputs())
        assertEquals("57", s.getString("seq")); assertEquals("1", s.getString("managerGeneration"))
        assertEquals("720", s.getJSONObject("collection").getJSONObject("counters").getJSONObject("packets").getString("eeg"))
        val txt = s.toString()
        for (bad in listOf("refresh_token", "access_token", "presignedUrl", "bytes_base64", "rawSamples")) assertFalse(bad, txt.contains(bad))
        assertTrue(s.getJSONObject("collection").getJSONObject("counters").getBoolean("js_heartbeat_independent"))
        assertEquals(536870912L, s.getJSONObject("archive").getJSONObject("queue").getLong("disk_limit_bytes"))
    }

    @Test fun noFrameYieldsNullMetrics() {
        assertTrue(BridgeModel.snapshot(inputs(withFrame = false)).isNull("metrics"))
    }

    @Test fun generatedMessagesPassContractSchema() {
        assumeTrue("node 필요", File("/opt/homebrew/bin/node").exists() || File("/usr/local/bin/node").exists() || File("/usr/bin/node").exists())
        assumeTrue(File(contractDir, "measurement-bridge/validate.mjs").exists())
        val i = inputs()
        val snap = BridgeModel.snapshot(i)
        val seq = BridgeSequencer(1)
        val msgs = JSONArray()
        msgs.put(JSONObject().put("kind", "snapshot").put("message", snap))
        msgs.put(JSONObject().put("kind", "event").put("message", BridgeModel.event("measurementUpdated", 1, seq.next(), 1760000000200, snap)))
        msgs.put(JSONObject().put("kind", "event").put("message", BridgeModel.event("archiveStatus", 1, seq.next(), 1760000000300,
            BridgeModel.archiveStatusPayload(i.sessionId, BridgeModel.queue(i), null, "presign", "http_503"))))
        msgs.put(JSONObject().put("kind", "event").put("message", BridgeModel.event("commandAck", 1, seq.next(), 1760000000400,
            JSONObject("""{"command_id":"0000000a-0000-4000-8000-00000000000a","status":"applied","epoch":"1","cursors":[],"committed":true}"""))))
        val f = File(tmp.root, "msgs.json"); f.writeText(msgs.toString())
        val script = File(tmp.root, "check.mjs")
        script.writeText("""
            import { validateBridge } from '${File(contractDir, "measurement-bridge/validate.mjs").toURI()}';
            import { readFileSync } from 'node:fs';
            const msgs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
            let bad = 0;
            for (const m of msgs) { const r = validateBridge(m.kind, m.message); if (!r.ok) { bad++; console.log(JSON.stringify({kind: m.kind, schema: r.schemaErrors.slice(0,5), sem: r.semanticErrors.slice(0,5)})); } }
            console.log('checked=' + msgs.length + ' bad=' + bad);
            process.exit(bad ? 1 : 0);
        """.trimIndent())
        val node = listOf("/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node").first { File(it).exists() }
        val p = ProcessBuilder(node, script.absolutePath, f.absolutePath).redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText(); val code = p.waitFor()
        assertEquals(out, 0, code)
        assertTrue(out, out.contains("bad=0"))
    }
}
