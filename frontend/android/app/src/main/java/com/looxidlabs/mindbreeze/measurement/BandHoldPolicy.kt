package com.looxidlabs.mindbreeze.measurement

/** SDD-293: 밴드 보류(hold) 요청/시작 시 기존 보류 링크를 어떻게 다룰지 정하는 순수 정책(JVM 시험 대상). */
object BandHoldPolicy {
    enum class Action { NEW, REUSE, REPLACE, IGNORE }

    /** adoptBand 요청: 수집 중이면 무시, 같은 주소 보류가 있으면 재사용, 다른 주소면 교체, 없으면 신규 */
    fun onAdopt(heldAddress: String?, requested: String, collecting: Boolean): Action = when {
        collecting -> Action.IGNORE
        heldAddress == null -> Action.NEW
        heldAddress.equals(requested, ignoreCase = true) -> Action.REUSE
        else -> Action.REPLACE
    }

    /** startMeasurement: 같은 주소 보류 링크가 있으면 재연결 없이 attach, 다르면 보류를 버리고 신규 연결 */
    fun onStart(heldAddress: String?, startAddress: String?): Action = when {
        heldAddress != null && startAddress != null && heldAddress.equals(startAddress, ignoreCase = true) -> Action.REUSE
        heldAddress != null -> Action.REPLACE
        else -> Action.NEW
    }
}
