package com.looxidlabs.mindbreeze.measurement

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.RandomAccessFile

class JournalTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun rec(i: Int) = JournalRecord(Sensor.EEG, 1000L + i, byteArrayOf(i.toByte(), 1, 2, 3))

    @Test fun appendThenRecoverReturnsAllRecordsInOrder() {
        val f = File(tmp.root, "a.journal")
        AppendOnlyJournal.open(f).use { j -> repeat(5) { j.append(rec(it)) }; assertEquals(5L, j.count) }
        val r = AppendOnlyJournal.recover(f)
        assertEquals(5, r.records.size)
        assertEquals(0, r.truncatedBytes)
        assertEquals(3, r.records[3].payload[0].toInt())
        assertEquals(1003L, r.records[3].arrivalMonoMs)
    }

    @Test fun tornTailIsTruncatedAndAppendResumes() {
        val f = File(tmp.root, "b.journal")
        AppendOnlyJournal.open(f).use { j -> repeat(3) { j.append(rec(it)) } }
        val full = f.length()
        RandomAccessFile(f, "rw").use { it.setLength(full - 3) } // 마지막 레코드 쓰기 중 kill
        val r = AppendOnlyJournal.recover(f)
        assertEquals(2, r.records.size)
        assertTrue(r.truncatedBytes > 0)
        // 복구 후 이어쓰기
        AppendOnlyJournal.open(f).use { j -> assertEquals(2L, j.count); j.append(rec(9)) }
        assertEquals(3, AppendOnlyJournal.recover(f).records.size)
    }

    @Test fun corruptedMiddleRecordStopsRecoveryAtLastGoodOffset() {
        val f = File(tmp.root, "c.journal")
        AppendOnlyJournal.open(f).use { j -> repeat(4) { j.append(rec(it)) } }
        val one = f.length() / 4
        RandomAccessFile(f, "rw").use { it.seek(one * 2 + 12); it.write(0x7E) } // 3번째 payload 손상
        val r = AppendOnlyJournal.recover(f)
        assertEquals(2, r.records.size)
        assertEquals(one * 2, f.length()) // 이후 손상 구간 잘림
    }

    @Test fun emptyOrMissingFileRecoversToZero() {
        assertEquals(0, AppendOnlyJournal.recover(File(tmp.root, "none.journal")).records.size)
        val f = File(tmp.root, "e.journal"); f.createNewFile()
        assertEquals(0, AppendOnlyJournal.recover(f).records.size)
    }

    @Test fun appendAfterCloseFails() {
        val j = AppendOnlyJournal.open(File(tmp.root, "d.journal"))
        j.close()
        try { j.append(rec(0)); fail() } catch (e: IllegalStateException) { }
    }
}
