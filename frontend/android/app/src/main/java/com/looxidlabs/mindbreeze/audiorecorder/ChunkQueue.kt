package com.looxidlabs.mindbreeze.audiorecorder

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

data class QueuedChunk(val sessionId: String, val index: Int, val file: File)

/**
 * 디스크 큐: `{root}/{sessionId}/{index}.m4a`, 세션 메타 `meta.json`(apiBase,nextIndex).
 * 임시파일(`.tmp`)은 확정(commit) 전 조각이라 재시작 시 버린다. 토큰은 저장하지 않는다.
 */
class ChunkQueue(private val root: File) {
    data class Meta(val apiBase: String, val nextIndex: Int)

    init { root.mkdirs(); purgeTemp() }

    private fun dir(sessionId: String) = File(root, sessionId)

    private fun purgeTemp() {
        root.listFiles()?.forEach { d -> d.listFiles()?.filter { it.name.endsWith(".tmp") }?.forEach { it.delete() } }
    }

    fun tempFile(sessionId: String, index: Int): File { dir(sessionId).mkdirs(); return File(dir(sessionId), "$index.m4a.tmp") }

    fun commit(sessionId: String, index: Int, tmp: File) {
        val dest = File(dir(sessionId), "$index.m4a")
        if (!tmp.renameTo(dest)) throw java.io.IOException("commit failed")
    }

    fun pending(sessionId: String): List<QueuedChunk> =
        (dir(sessionId).listFiles() ?: emptyArray()).mapNotNull { f ->
            if (!f.name.endsWith(".m4a")) null else f.name.removeSuffix(".m4a").toIntOrNull()?.let { QueuedChunk(sessionId, it, f) }
        }.sortedBy { it.index }

    fun sessionsWithPending(): List<String> =
        (root.listFiles() ?: emptyArray()).filter { it.isDirectory && pending(it.name).isNotEmpty() }.map { it.name }.sorted()

    /** 해당 apiBase 의 메타를 가진 세션 중 가장 앞 대기 청크 */
    fun next(apiBase: String): QueuedChunk? =
        sessionsWithPending().firstOrNull { loadMeta(it)?.apiBase == apiBase }?.let { pending(it).firstOrNull() }

    /** 메타가 있는 세션의 가장 앞 대기 청크 */
    fun nextAny(): QueuedChunk? =
        sessionsWithPending().firstOrNull { loadMeta(it) != null }?.let { pending(it).firstOrNull() }

    fun remove(c: QueuedChunk) { c.file.delete() }

    fun totalBytes(): Long = (root.listFiles() ?: emptyArray()).filter { it.isDirectory }.sumOf { d ->
        (d.listFiles() ?: emptyArray()).filter { it.name.endsWith(".m4a") }.sumOf { it.length() }
    }

    fun saveMeta(sessionId: String, m: Meta) {
        dir(sessionId).mkdirs()
        val f = File(dir(sessionId), "meta.json"); val tmp = File(f.path + ".tmp")
        FileOutputStream(tmp).use { it.write(JSONObject().put("apiBase", m.apiBase).put("nextIndex", m.nextIndex).toString().toByteArray()); it.fd.sync() }
        tmp.renameTo(f)
    }

    fun loadMeta(sessionId: String): Meta? = try {
        val f = File(dir(sessionId), "meta.json")
        if (!f.exists()) null else JSONObject(f.readText()).let { Meta(it.getString("apiBase"), it.getInt("nextIndex")) }
    } catch (_: Exception) { null }

    /** 대기 청크가 없는 세션 디렉터리를 정리한다(`except` 는 유지). */
    fun sweepEmpty(except: String?) {
        (root.listFiles() ?: emptyArray()).filter { it.isDirectory && it.name != except && pending(it.name).isEmpty() }
            .forEach { it.deleteRecursively() }
    }
}
