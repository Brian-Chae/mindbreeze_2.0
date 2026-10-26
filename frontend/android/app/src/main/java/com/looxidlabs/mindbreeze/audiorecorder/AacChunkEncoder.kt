package com.looxidlabs.mindbreeze.audiorecorder

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File

/** PCM16 mono 44.1kHz → AAC-LC 64kbps m4a(MPEG-4). 청크마다 독립 파일. */
class AacChunkEncoder : ChunkEncoder {
    override fun encode(pcm: ShortArray, out: File) {
        val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, ChunkSplitter.SAMPLE_RATE, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 64_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        var muxer: MediaMuxer? = null
        var muxerStarted = false
        try {
            codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            out.delete()
            muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var track = -1
            val info = MediaCodec.BufferInfo()
            val bytes = ByteArray(pcm.size * 2)
            for (i in pcm.indices) { bytes[2 * i] = (pcm[i].toInt() and 0xff).toByte(); bytes[2 * i + 1] = (pcm[i].toInt() shr 8).toByte() }
            var off = 0; var inputDone = false; var outputDone = false
            val samplesTotal = pcm.size.toLong()
            var guard = 0
            while (!outputDone) {
                if (++guard > 200_000) throw IllegalStateException("encoder stalled")
                if (!inputDone) {
                    val ix = codec.dequeueInputBuffer(10_000)
                    if (ix >= 0) {
                        val buf = codec.getInputBuffer(ix)!!
                        buf.clear()
                        val n = minOf(buf.remaining(), bytes.size - off)
                        if (n > 0) buf.put(bytes, off, n)
                        val ptsUs = (off / 2) * 1_000_000L / ChunkSplitter.SAMPLE_RATE
                        off += n
                        if (off >= bytes.size) { codec.queueInputBuffer(ix, 0, n, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else codec.queueInputBuffer(ix, 0, n, ptsUs, 0)
                    }
                }
                val ox = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    ox == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer.addTrack(codec.outputFormat); muxer.start(); muxerStarted = true }
                    ox >= 0 -> {
                        val ob = codec.getOutputBuffer(ox)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && muxerStarted) { ob.position(info.offset); ob.limit(info.offset + info.size); muxer.writeSampleData(track, ob, info) }
                        codec.releaseOutputBuffer(ox, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
            check(samplesTotal == pcm.size.toLong())
            check(muxerStarted) { "no output" }
        } finally {
            try { codec.stop() } catch (_: Exception) {}
            codec.release()
            try { if (muxerStarted) muxer?.stop() } catch (_: Exception) {}
            try { muxer?.release() } catch (_: Exception) {}
        }
    }
}
