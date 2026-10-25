package com.looxidlabs.mindbreeze.measurement

import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.zip.CRC32

data class JournalRecord(val sensor: Sensor, val arrivalMonoMs: Long, val payload: ByteArray)

data class RecoveryResult(val records: List<JournalRecord>, val truncatedBytes: Long, val goodLength: Long)

/**
 * append-only raw journal. 레코드: [bodyLen u32][crc32(body) u32][body: sensor u8, arrivalMonoMs i64, payload].
 * append 마다 fsync 하고, 열 때 마지막 정상 레코드까지 복구(찢긴 꼬리·손상 구간 절단).
 */
class AppendOnlyJournal private constructor(private val file: File, private val syncEach: Boolean, initialCount: Long) : Closeable {
    private val out = FileOutputStream(file, true)
    private var closed = false
    var count: Long = initialCount
        private set
    var bytesWritten: Long = file.length()
        private set

    @Synchronized
    fun append(r: JournalRecord) {
        check(!closed) { "journal closed" }
        val body = ByteBuffer.allocate(9 + r.payload.size).apply {
            put(r.sensor.id.toByte()); putLong(r.arrivalMonoMs); put(r.payload)
        }.array()
        val crc = CRC32().apply { update(body) }.value
        val rec = ByteBuffer.allocate(8 + body.size).apply { putInt(body.size); putInt(crc.toInt()); put(body) }.array()
        out.write(rec)
        out.flush()
        if (syncEach) out.fd.sync()
        count++
        bytesWritten += rec.size
    }

    @Synchronized
    override fun close() {
        if (closed) return
        closed = true
        out.close()
    }

    companion object {
        private const val MAX_BODY = 1 shl 16

        fun open(file: File, syncEach: Boolean = true): AppendOnlyJournal {
            file.parentFile?.mkdirs()
            val rec = recover(file)
            return AppendOnlyJournal(file, syncEach, rec.records.size.toLong())
        }

        /** 파일을 정상 구간까지 절단하고 레코드를 반환. 파일이 없으면 빈 결과. */
        fun recover(file: File): RecoveryResult {
            if (!file.exists()) return RecoveryResult(emptyList(), 0, 0)
            val records = ArrayList<JournalRecord>()
            var good = 0L
            val total = file.length()
            RandomAccessFile(file, "r").use { raf ->
                val head = ByteArray(8)
                while (true) {
                    if (total - good < 8) break
                    raf.seek(good); raf.readFully(head)
                    val bb = ByteBuffer.wrap(head)
                    val len = bb.int; val crc = bb.int.toLong() and 0xFFFFFFFFL
                    if (len < 9 || len > MAX_BODY || total - good - 8 < len) break
                    val body = ByteArray(len); raf.readFully(body)
                    if (CRC32().apply { update(body) }.value != crc) break
                    val s = Sensor.fromId(body[0].toInt()) ?: break
                    val arrival = ByteBuffer.wrap(body, 1, 8).long
                    records += JournalRecord(s, arrival, body.copyOfRange(9, len))
                    good += 8 + len
                }
            }
            val truncated = total - good
            if (truncated > 0) RandomAccessFile(file, "rw").use { it.setLength(good) }
            return RecoveryResult(records, truncated, good)
        }
    }
}
