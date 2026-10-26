package com.looxidlabs.mindbreeze.audiorecorder

/** 상태: idle/recording/paused/micOff/stopping/stopped/error. 일시정지 중 마이크 변경은 재개 시 반영한다. */
class RecorderStateMachine {
    private var phase = "idle" // idle | active | stopping | stopped | error
    private var paused = false
    private var micOn = true

    val state: String get() = when (phase) {
        "active" -> if (paused) "paused" else if (!micOn) "micOff" else "recording"
        "idle" -> "idle"
        "stopping" -> "stopping"
        "stopped" -> "stopped"
        else -> "error"
    }
    val active: Boolean get() = phase == "active"
    val capturing: Boolean get() = phase == "active" && !paused && micOn

    fun start() { phase = "active"; paused = false; micOn = true }
    fun pause() { if (active) paused = true }
    fun resume() { if (active) paused = false }
    fun setMic(on: Boolean) { if (active) micOn = on }
    fun beginStop() { if (active) phase = "stopping" }
    fun finishStop() { if (phase == "stopping" || phase == "active") phase = "stopped" }
    fun fail() { if (phase == "active" || phase == "stopping") phase = "error" }
}
