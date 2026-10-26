package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * live 지표 창의 durable 송신 큐. ACK(accepted/duplicate)가 오기 전에는 지우지 않는다(메모리만 보관한 창은 완료가 아님).
 * 형식: 줄 단위 "E\t<seq>\t<json>" 추가 / "A\t<seq>" 확정 / "Q\t<seq>\t<code>" 격리. 열 때 재생해 미확정만 복원한다.
 * 격리(T05b): 서버가 창을 rejected 로 답하면 재전송해도 같은 결과라 live 송신에서 빼고 코드별로 센다(acked 와 별도).
 * 원본은 journal·archive 경로에 남는다. 격리된 순번은 같은 outbox 수명 동안 다시 넣지 않는다.
 */
class MetricOutbox(private val file: File, private val nowMs: () -> Long = { System.currentTimeMillis() }) {
    private class Item(val seq: Long, val json: JSONObject, val addedAtMs: Long)

    private val pending = java.util.TreeMap<Long, Item>()
    private var out: FileOutputStream? = null
    private var ackedTotal = 0L
    private var lines = 0
    private val quarantinedSeqs = java.util.TreeMap<Long, String>() // seq -> 거절 코드

    init { load(); out = FileOutputStream(file, true) }

    private fun load() {
        if (!file.exists()) return
        val acked = HashSet<Long>()
        val items = LinkedHashMap<Long, Item>()
        file.useLines { seq ->
            for (line in seq) {
                lines++
                val p = line.split('\t', limit = 3)
                try {
                    when (p[0]) {
                        "E" -> items[p[1].toLong()] = Item(p[1].toLong(), JSONObject(p[2]), nowMs())
                        "A" -> acked += p[1].toLong()
                        "Q" -> quarantinedSeqs.putIfAbsent(p[1].toLong(), p.getOrElse(2) { "unknown" })
                    }
                } catch (_: Exception) { /* 찢긴 마지막 줄 무시 */ }
            }
        }
        for ((k, v) in items) if (k !in acked && !quarantinedSeqs.containsKey(k)) pending[k] = v
        ackedTotal = acked.size.toLong()
    }

    @Synchronized
    fun add(seq: Long, json: JSONObject) {
        if (pending.containsKey(seq) || quarantinedSeqs.containsKey(seq)) return // 같은 순번 재투입은 한 번만(중복 창 방어), 격리 순번은 재투입 금지
        append("E\t$seq\t$json\n")
        pending[seq] = Item(seq, json, nowMs())
    }

    @Synchronized
    fun ack(seq: Long) {
        if (pending.remove(seq) == null) return
        ackedTotal++
        append("A\t$seq\n")
        if (lines > 5000 && pending.size < lines / 4) compact()
    }

    /** 최신 창 우선(plan §3.4: 복구 시 최신창 먼저, 빠진 창은 뒤에서 모두 전송). */
    @Synchronized
    fun newestFirst(max: Int): List<Pair<Long, JSONObject>> = pending.descendingMap().values.take(max).map { it.seq to it.json }

    /** 영구 거절(재전송 금지) 창을 live 송신에서 뺀다. 아직 큐에 없던 순번(예: 범위 초과)도 기록만 한다. */
    @Synchronized
    fun quarantine(seq: Long, code: String) {
        if (quarantinedSeqs.containsKey(seq)) return
        pending.remove(seq)
        val c = code.takeIf { REASON.matches(it) } ?: "unknown"
        quarantinedSeqs[seq] = c
        append("Q\t$seq\t$c\n")
    }

    @Synchronized fun quarantined(): Long = quarantinedSeqs.size.toLong()
    @Synchronized fun quarantinedByCode(): Map<String, Long> = quarantinedSeqs.values.groupingBy { it }.eachCount().mapValues { it.value.toLong() }
    @Synchronized fun size(): Int = pending.size
    @Synchronized fun acked(): Long = ackedTotal
    @Synchronized fun oldestAgeMs(): Long? = pending.firstEntry()?.value?.let { nowMs() - it.addedAtMs }
    @Synchronized fun contains(seq: Long) = pending.containsKey(seq)

    private fun append(s: String) {
        val o = out ?: return
        o.write(s.toByteArray()); o.flush(); o.fd.sync(); lines++
    }

    private fun compact() {
        out?.close()
        val tmp = File(file.path + ".tmp")
        tmp.bufferedWriter().use { w ->
            for (i in pending.values) w.write("E\t${i.seq}\t${i.json}\n")
            // 격리 기록은 압축 후에도 남긴다(재시작 후 재투입·재전송 방지, 카운터 유지)
            for ((q, c) in quarantinedSeqs) w.write("Q\t$q\t$c\n")
        }
        tmp.renameTo(file)
        lines = pending.size + quarantinedSeqs.size
        out = FileOutputStream(file, true)
    }

    companion object { private val REASON = Regex("^[a-z][a-z0-9_]{0,63}$") }

    @Synchronized fun close() { out?.close(); out = null }
}
