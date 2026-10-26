package com.looxidlabs.mindbreeze.measurement

/** 기기 시트 미리보기용 최근 원시 샘플 링버퍼(EEG 250Hz·PPG 50Hz). 수치만 담는다 — 원문 바이트·토큰 없음. */
class RawPreviewBuffer(private val eegCapacity: Int = 1000, private val ppgCapacity: Int = 200) {
    data class Preview(val eegFp1: List<Double>, val eegFp2: List<Double>, val ppgRed: List<Double>, val ppgIr: List<Double>)

    private val fp1 = ArrayDeque<Double>(); private val fp2 = ArrayDeque<Double>()
    private val red = ArrayDeque<Double>(); private val ir = ArrayDeque<Double>()

    @Synchronized fun addEeg(samples: List<EegSample>) {
        for (s in samples) { fp1.addLast(s.ch1Uv); fp2.addLast(s.ch2Uv) }
        while (fp1.size > eegCapacity) { fp1.removeFirst(); fp2.removeFirst() }
    }

    @Synchronized fun addPpg(samples: List<PpgSample>) {
        for (s in samples) { red.addLast(s.red.toDouble()); ir.addLast(s.ir.toDouble()) }
        while (red.size > ppgCapacity) { red.removeFirst(); ir.removeFirst() }
    }

    @Synchronized fun preview(points: Int): Preview =
        Preview(down(fp1, points), down(fp2, points), down(red, points), down(ir, points))

    /** 처음·끝을 유지하는 균등 추출 */
    private fun down(src: ArrayDeque<Double>, count: Int): List<Double> {
        val n = src.size
        if (n == 0) return emptyList()
        if (n <= count) return src.toList()
        if (count < 2) return listOf(src.last())
        val last = n - 1
        return List(count) { i -> src[Math.round(i.toDouble() * last / (count - 1)).toInt()] }
    }
}
