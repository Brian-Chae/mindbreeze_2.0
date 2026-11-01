package com.looxidlabs.mindbreeze.measurement.live

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * feature 창의 durable 송신 큐(SDD-260: REST 배치 업로드의 정본 전송원).
 * 서버 REST ACK(accepted/duplicate)가 오면 pending 에서 빼되, **삭제하지 않고 ackedItems 로 보관**한다 — 종료 후 summary 대조에서
 * 서버에 없는 창을 다시 보내기 위한 로컬 사본이다. 소켓 ACK 는 이 큐를 건드리지 않는다(소켓은 방송 전용).
 *
 * 형식: 줄 단위 "E\t<seq>\t<json>" 추가 / "B\t<seq>\t<tag>" stream 귀속 / "A\t<seq>" REST 확정 / "R\t<seq>" 재큐잉(확정 취소) /
 * "Q\t<seq>\t<code>" 격리 / "C\t1" 서버 대조 완료 표식(이후 E 가 오면 무효). 열 때 재생해 상태를 복원한다.
 * 격리: 서버가 4종 거절 코드(consent_withdrawn·participant_mismatch·stream_not_owned·hash_conflict)로 답한 창. 재전송해도 같은 결과다.
 */
/** 창이 만들어진 시점의 stream 신원. 재연결·재시작 후에도 이 신원으로만 전송한다. */
data class StreamTag(val streamId: String, val generation: String, val anchorId: String, val participantId: String)

/** 송신 후보 한 건: 순번·원본 프레임·귀속 stream. */
class OutboxEntry(val seq: Long, val json: JSONObject, val tag: StreamTag)

class MetricOutbox(private val file: File, private val nowMs: () -> Long = { System.currentTimeMillis() }) {
    private class Item(val seq: Long, val json: JSONObject, val addedAtMs: Long, var tag: StreamTag? = null)

    private val pending = java.util.TreeMap<Long, Item>()
    private val ackedItems = java.util.TreeMap<Long, Item>()
    private var out: FileOutputStream? = null
    private var ackedTotal = 0L
    private var lines = 0
    private var reconciled = false
    private val quarantinedSeqs = java.util.TreeMap<Long, String>() // seq -> 거절 코드

    init { load(); out = FileOutputStream(file, true) }

    private fun load() {
        if (!file.exists()) return
        val acked = HashSet<Long>()
        val bound = HashMap<Long, StreamTag>()
        val items = LinkedHashMap<Long, JSONObject>()
        file.useLines { seq ->
            for (line in seq) {
                lines++
                val p = line.split('\t', limit = 3)
                try {
                    when (p[0]) {
                        "E" -> { items[p[1].toLong()] = JSONObject(p[2]); reconciled = false }
                        "B" -> { val t = JSONObject(p[2]); bound[p[1].toLong()] = StreamTag(t.getString("s"), t.getString("g"), t.getString("a"), t.getString("p")) }
                        "A" -> acked += p[1].toLong()
                        "R" -> acked -= p[1].toLong()
                        "Q" -> quarantinedSeqs.putIfAbsent(p[1].toLong(), p.getOrElse(2) { "unknown" })
                        "C" -> reconciled = true
                    }
                } catch (_: Exception) { /* 찢긴 마지막 줄 무시 */ }
            }
        }
        for ((k, json) in items) {
            if (quarantinedSeqs.containsKey(k)) continue
            val item = Item(k, json, nowMs(), bound[k])
            if (k in acked) ackedItems[k] = item else pending[k] = item
        }
        ackedTotal = ackedItems.size.toLong()
    }

    @Synchronized
    fun add(seq: Long, json: JSONObject, tag: StreamTag? = null) {
        if (pending.containsKey(seq) || ackedItems.containsKey(seq) || quarantinedSeqs.containsKey(seq)) return // 같은 순번 재투입은 한 번만, 격리 순번은 재투입 금지
        append("E\t$seq\t$json\n")
        reconciled = false
        val item = Item(seq, json, nowMs())
        pending[seq] = item
        if (tag != null) bind(item, tag)
    }

    private fun bind(i: Item, tag: StreamTag) {
        i.tag = tag
        append("B\t${i.seq}\t${tagJson(tag)}\n")
    }

    private fun tagJson(t: StreamTag) = JSONObject().put("s", t.streamId).put("g", t.generation).put("a", t.anchorId).put("p", t.participantId)

    /**
     * 귀속 없이 쌓인 창(stream 이 생기기 전에 만든 창, 또는 귀속 기록 없이 복원된 창)을 주어진 stream 에 귀속(영속)한다.
     * 같은 세션 디렉터리의 창이라 세션·참가자는 같다. 반환: 귀속한 창 수.
     */
    @Synchronized
    fun bindUntagged(tag: StreamTag): Int {
        var n = 0
        for (i in pending.values) if (i.tag == null) { bind(i, tag); n++ }
        return n
    }

    /**
     * REST 전송 후보(오래된 순서, 최대 max). 귀속된 창만, 한 묶음은 한 참가자(요청의 participant_id 가 하나다). stream 은 섞여도 된다.
     * 귀속 전 창은 격리하지 않고 보관한다(귀속은 stream 이 생기면 bindUntagged 가 한다).
     */
    @Synchronized
    fun pendingBatch(max: Int): List<OutboxEntry> {
        val result = ArrayList<OutboxEntry>()
        var pid: String? = null
        for (i in pending.values) {
            val t = i.tag ?: continue
            if (pid == null) pid = t.participantId else if (t.participantId != pid) continue
            result += OutboxEntry(i.seq, i.json, t)
            if (result.size >= max) break
        }
        return result
    }

    /** REST 가 저장을 확인(accepted/duplicate)한 창. 삭제하지 않고 대조용으로 보관한다. */
    @Synchronized
    fun ack(seq: Long) {
        val it = pending.remove(seq) ?: return
        ackedItems[seq] = it
        ackedTotal++
        append("A\t$seq\n")
    }

    /** 대조에서 서버에 없다고 확인된 창을 다시 전송 대상으로 되돌린다. 반환: 되돌린 수. */
    @Synchronized
    fun requeue(seqs: Collection<Long>): Int {
        var n = 0
        for (s in seqs) {
            val it = ackedItems.remove(s) ?: continue
            pending[s] = it; ackedTotal--; n++
            append("R\t$s\n")
        }
        if (n > 0) reconciled = false
        return n
    }

    /** 확정(REST ACK)된 채 보관 중인 창(귀속된 것만). 대조용. */
    @Synchronized
    fun ackedEntries(): List<OutboxEntry> = ackedItems.values.mapNotNull { i -> i.tag?.let { OutboxEntry(i.seq, i.json, it) } }

    /** 서버 summary 대조가 끝났음을 영속한다. 새 창이 들어오면 자동 무효. */
    @Synchronized
    fun markReconciled() {
        if (reconciled) return
        reconciled = true
        append("C\t1\n")
    }

    @Synchronized fun isReconciled(): Boolean = reconciled && sendableCount() == 0

    /** 귀속(stream 신원)이 있어 REST 로 보낼 수 있는 대기 창 수. */
    @Synchronized fun sendableCount(): Int = pending.values.count { it.tag != null }

    /** stream 이 한 번도 확정되지 않아 보낼 수 없는 창 수(gap(local_unattributed) 진단). */
    @Synchronized fun untaggedCount(): Int = pending.values.count { it.tag == null }

    /** 영구 거절(재전송 금지) 창을 송신에서 뺀다. 아직 큐에 없던 순번(예: 범위 초과)도 기록만 한다. */
    @Synchronized
    fun quarantine(seq: Long, code: String) {
        if (quarantinedSeqs.containsKey(seq)) return
        pending.remove(seq); ackedItems.remove(seq)
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
    /** 로컬에 보관 중인(격리 제외) 창의 가장 큰 순번. 없으면 null. */
    @Synchronized fun maxSequence(): Long? = listOfNotNull(pending.lastEntry()?.key, ackedItems.lastEntry()?.key).maxOrNull()

    private fun append(s: String) {
        val o = out ?: return
        o.write(s.toByteArray()); o.flush(); o.fd.sync(); lines++
        // 확정 창도 보관하므로 줄 수는 보관 창 수에 비례한다. 재큐잉·격리로 죽은 줄이 많이 쌓였을 때만 압축한다.
        if (lines > 20_000 && lines > 6 * (pending.size + ackedItems.size) + 1000) compact()
    }

    private fun compact() {
        out?.close()
        val tmp = File(file.path + ".tmp")
        tmp.bufferedWriter().use { w ->
            for (i in (ackedItems.values + pending.values).sortedBy { it.seq }) {
                w.write("E\t${i.seq}\t${i.json}\n")
                i.tag?.let { t -> w.write("B\t${i.seq}\t${tagJson(t)}\n") }
                if (ackedItems.containsKey(i.seq)) w.write("A\t${i.seq}\n")
            }
            for ((q, c) in quarantinedSeqs) w.write("Q\t$q\t$c\n")
            if (reconciled) w.write("C\t1\n")
        }
        tmp.renameTo(file)
        lines = (ackedItems.size * 3) + (pending.size * 2) + quarantinedSeqs.size
        out = FileOutputStream(file, true)
    }

    companion object { private val REASON = Regex("^[a-z][a-z0-9_]{0,63}$") }

    @Synchronized fun close() { out?.close(); out = null }
}
