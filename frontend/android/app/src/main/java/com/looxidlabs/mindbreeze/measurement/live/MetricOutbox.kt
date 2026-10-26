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
/** 창이 만들어진 시점의 stream 신원. 재연결·재시작 후에도 이 신원으로만 전송한다. */
data class StreamTag(val streamId: String, val generation: String, val anchorId: String, val participantId: String)

/** 송신 후보 한 건: 순번·원본 프레임·귀속 stream. */
class OutboxEntry(val seq: Long, val json: JSONObject, val tag: StreamTag)

class MetricOutbox(private val file: File, private val nowMs: () -> Long = { System.currentTimeMillis() }) {
    private class Item(val seq: Long, val json: JSONObject, val addedAtMs: Long, var tag: StreamTag? = null, val fromDisk: Boolean = false)

    private val pending = java.util.TreeMap<Long, Item>()
    private var out: FileOutputStream? = null
    private var ackedTotal = 0L
    private var lines = 0
    private val quarantinedSeqs = java.util.TreeMap<Long, String>() // seq -> 거절 코드

    init { load(); out = FileOutputStream(file, true) }

    private fun load() {
        if (!file.exists()) return
        val acked = HashSet<Long>()
        val bound = HashMap<Long, StreamTag>()
        val items = LinkedHashMap<Long, Item>()
        file.useLines { seq ->
            for (line in seq) {
                lines++
                val p = line.split('\t', limit = 3)
                try {
                    when (p[0]) {
                        "E" -> items[p[1].toLong()] = Item(p[1].toLong(), JSONObject(p[2]), nowMs(), null, true)
                        "B" -> { val t = JSONObject(p[2]); bound[p[1].toLong()] = StreamTag(t.getString("s"), t.getString("g"), t.getString("a"), t.getString("p")) }
                        "A" -> acked += p[1].toLong()
                        "Q" -> quarantinedSeqs.putIfAbsent(p[1].toLong(), p.getOrElse(2) { "unknown" })
                    }
                } catch (_: Exception) { /* 찢긴 마지막 줄 무시 */ }
            }
        }
        for ((k, v) in items) if (k !in acked && !quarantinedSeqs.containsKey(k)) { v.tag = bound[k]; pending[k] = v }
        ackedTotal = acked.size.toLong()
    }

    @Synchronized
    fun add(seq: Long, json: JSONObject, tag: StreamTag? = null) {
        if (pending.containsKey(seq) || quarantinedSeqs.containsKey(seq)) return // 같은 순번 재투입은 한 번만(중복 창 방어), 격리 순번은 재투입 금지
        append("E\t$seq\t$json\n")
        pending[seq] = Item(seq, json, nowMs())
        if (tag != null) bind(pending.getValue(seq), tag)
    }

    private fun bind(i: Item, tag: StreamTag) {
        i.tag = tag
        append("B\t${i.seq}\t${JSONObject().put("s", tag.streamId).put("g", tag.generation).put("a", tag.anchorId).put("p", tag.participantId)}\n")
    }

    /**
     * 다음 송신 묶음. 현재 stream 의 창이 있으면 그것만(최신 우선, 최대 max), 없으면 가장 오래된 다른 stream 의 창을
     * 그 stream 의 옛 신원으로 보낸다 — 한 묶음에 서로 다른 stream 을 섞지 않는다.
     * 귀속 없이 이번 프로세스에서 넣은 창은 현재 stream 에 귀속(영속)하고, 디스크에서 복원했는데 귀속 기록이 없는 창은
     * 어느 stream 의 것인지 알 수 없어 새 stream 으로 보내지 않고 격리(stream_unattributed)한다.
     */
    @Synchronized
    fun nextBatch(current: StreamTag?, max: Int): List<OutboxEntry>? {
        for (i in pending.values.filter { it.tag == null && it.fromDisk }) quarantine(i.seq, "stream_unattributed")
        if (current != null) for (i in pending.values) if (i.tag == null) bind(i, current)
        val tagged = pending.descendingMap().values.filter { it.tag != null }
        if (tagged.isEmpty()) return null
        fun key(t: StreamTag) = t.streamId + "/" + t.generation
        val group = current?.let { c -> tagged.filter { key(it.tag!!) == key(c) } }?.takeIf { it.isNotEmpty() }
            ?: tagged.last().let { oldest -> tagged.filter { key(it.tag!!) == key(oldest.tag!!) } }
        return group.take(max).map { OutboxEntry(it.seq, it.json, it.tag!!) }
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
            for (i in pending.values) {
                w.write("E\t${i.seq}\t${i.json}\n")
                i.tag?.let { t -> w.write("B\t${i.seq}\t${JSONObject().put("s", t.streamId).put("g", t.generation).put("a", t.anchorId).put("p", t.participantId)}\n") }
            }
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
