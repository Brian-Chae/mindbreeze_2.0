package com.looxidlabs.mindbreeze.audiorecorder

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

/** AudioRecord 44.1kHz mono PCM16. 권한 확인은 호출자 책임. */
class AudioRecordSource : AudioSource {
    private var rec: AudioRecord? = null

    @SuppressLint("MissingPermission")
    private fun ensure(): AudioRecord {
        rec?.let { return it }
        val min = AudioRecord.getMinBufferSize(ChunkSplitter.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) throw IllegalStateException("bad buffer size")
        val r = AudioRecord(MediaRecorder.AudioSource.MIC, ChunkSplitter.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min * 4)
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); throw IllegalStateException("AudioRecord not initialized") }
        rec = r; return r
    }

    override fun start() { ensure().startRecording() }
    override fun read(buf: ShortArray): Int = rec?.read(buf, 0, buf.size) ?: -1
    override fun stop() { try { rec?.stop() } catch (_: IllegalStateException) {} }
    override fun release() { try { rec?.release() } catch (_: Exception) {}; rec = null }
}
