package com.looxidlabs.mindbreeze.audiorecorder

/** 연속 PCM 을 고정 샘플 수 청크로 자른다. 경계 샘플 유실·중복 없음. 스레드 비안전(호출자가 직렬화). */
class ChunkSplitter(private val samplesPerChunk: Int, private val onChunk: (ShortArray) -> Unit) {
    companion object {
        const val SAMPLE_RATE = 44_100
        /** 5초 @44.1kHz mono */
        const val DEFAULT_SAMPLES_PER_CHUNK = SAMPLE_RATE * 5
    }

    private var buf = ShortArray(samplesPerChunk)
    private var fill = 0
    val buffered: Int get() = fill

    fun write(src: ShortArray, len: Int) {
        var off = 0
        val n = minOf(len, src.size)
        while (off < n) {
            val take = minOf(samplesPerChunk - fill, n - off)
            System.arraycopy(src, off, buf, fill, take)
            fill += take; off += take
            if (fill == samplesPerChunk) { val full = buf; buf = ShortArray(samplesPerChunk); fill = 0; onChunk(full) }
        }
    }

    /** 남은 샘플을 짧은 청크로 내보낸다. 내보낸 샘플 수(없으면 0). */
    fun flush(): Int {
        if (fill == 0) return 0
        val n = fill
        val part = buf.copyOf(n); fill = 0
        onChunk(part)
        return n
    }

    /** 남은 샘플을 버린다. */
    fun clear() { fill = 0 }
}
