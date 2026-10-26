package com.looxidlabs.mindbreeze.measurement

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * T08d 실측 결함 회귀: 서버는 창 시각을 `anchor_server_at + (window_start_us − anchor monotonic_us)` 로 환산한다.
 * 따라서 capture.reanchor 의 monotonic_us 는 코어가 창에 쓰는 시간축(벽시계 앵커 + 단조 경과 µs)과 같아야 한다.
 * (실기기: elapsedRealtime µs 를 보내 창 시각이 수십 년 뒤로 환산 → lease 만료 후 beyond_offline_bound 로 30창 거절)
 */
class ReanchorTimelineTest {
    @get:Rule val tmp = TemporaryFolder()
    private val synth = File(File(System.getProperty("mb.contract.dir") ?: "../../contracts"), "biosignal-golden/v1/synth")

    @Test fun reanchorMonotonicIsOnWindowTimeline() {
        assumeTrue(MeasurementCore.available())
        val blob = File(synth, "stream.bin").readBytes()
        val sched = JSONArray(File(synth, "schedule.json").readText())
        var clock = 0L
        var lastEegClock = 0L
        val bootMs = 75_000_000L // 기기 uptime(elapsedRealtime) 흉내 — 벽시계와 다른 축
        val wallMs = 1_792_980_000_000L
        val e = MeasurementEngine(File(tmp.root, "j"), clockMs = { clock }, syncEach = false, core = MeasurementCore.create(MeasurementCore.DEFAULT_CONFIG),
            wallAnchorMs = wallMs, anchorMonoUs = bootMs * 1000)
        e.open(); val gen = e.fence.acquire()
        val frames = ArrayList<JSONObject>(); e.frameSink = { frames += it }
        for (i in 0 until sched.length()) {
            val r = sched.getJSONArray(i)
            clock = bootMs + r.getLong(0) / 1000
            val s = when (r.getString(1)) { "eeg" -> Sensor.EEG; "ppg" -> Sensor.PPG; else -> Sensor.ACC }
            if (s == Sensor.EEG) lastEegClock = clock
            e.onNotification(gen, s, blob.copyOfRange(r.getInt(2), r.getInt(2) + r.getInt(3)))
        }
        assertTrue(frames.size > 100)
        val anchorUs = e.lastEegAnchor!!.second
        val lastEnd = frames.last().getString("window_end_us").toLong()
        // 마지막 EEG 도착 시각과 마지막 창 종료 시각은 같은 축에서 수 초 이내여야 한다
        assertTrue("anchor=$anchorUs lastEnd=$lastEnd", Math.abs(anchorUs - lastEnd) < 3_000_000)
        assertEquals("벽시계 앵커 + 단조 경과", wallMs * 1000 + (lastEegClock * 1000 - bootMs * 1000), anchorUs)
    }
}
