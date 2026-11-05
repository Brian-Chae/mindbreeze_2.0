package com.looxidlabs.mindbreeze.measurement

import com.looxidlabs.mindbreeze.measurement.BandHoldPolicy.Action
import org.junit.Assert.assertEquals
import org.junit.Test

/** SDD-293 — 밴드 보류 정책. 같은 주소는 재사용(재연결 0회), 다른 주소는 교체, 수집 중 adopt 는 무시. */
class BandHoldPolicyTest {
    @Test fun adoptNewWhenNothingHeld() = assertEquals(Action.NEW, BandHoldPolicy.onAdopt(null, "AA:BB", false))
    @Test fun adoptSameAddressReuses() = assertEquals(Action.REUSE, BandHoldPolicy.onAdopt("aa:bb", "AA:BB", false))
    @Test fun adoptOtherAddressReplaces() = assertEquals(Action.REPLACE, BandHoldPolicy.onAdopt("AA:BB", "CC:DD", false))
    @Test fun adoptWhileCollectingIgnored() = assertEquals(Action.IGNORE, BandHoldPolicy.onAdopt(null, "AA:BB", true))
    @Test fun startReusesSameHeldLink() = assertEquals(Action.REUSE, BandHoldPolicy.onStart("AA:BB", "aa:bb"))
    @Test fun startReplacesDifferentHeldLink() = assertEquals(Action.REPLACE, BandHoldPolicy.onStart("AA:BB", "CC:DD"))
    @Test fun startWithoutHeldIsNew() = assertEquals(Action.NEW, BandHoldPolicy.onStart(null, "AA:BB"))
}
