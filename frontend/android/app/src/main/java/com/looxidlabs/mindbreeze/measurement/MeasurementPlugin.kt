package com.looxidlabs.mindbreeze.measurement

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** WebView 는 조회·시작·중지 제어만 한다. 수집·journal·프레임은 Service 소유. */
@CapacitorPlugin(name = "NativeMeasurement")
class MeasurementPlugin : Plugin() {
    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("platform", "android"); put("nativeMeasurement", true); put("spike", true)
            put("foregroundServiceType", "connectedDevice"); put("microphoneRequired", false)
            put("rustCore", false)
        })
    }

    @PluginMethod
    fun setNativeOwnership(call: PluginCall) {
        MeasurementManager.ownership.nativeEnabled = call.getBoolean("enabled", false) == true
        call.resolve(JSObject().put("enabled", MeasurementManager.ownership.nativeEnabled))
    }

    @PluginMethod
    fun startMeasurement(call: PluginCall) {
        val synthetic = call.getBoolean("synthetic", false) == true
        val address = call.getString("address")
        if (!synthetic && !MeasurementManager.ownership.nativeEnabled) {
            call.reject("native_ownership_disabled"); return
        }
        if (address == null && !synthetic) { call.reject("address_required"); return }
        MeasurementService.start(context, address, synthetic)
        call.resolve(JSObject().put("requested", true))
    }

    @PluginMethod
    fun stopMeasurement(call: PluginCall) {
        MeasurementService.stop(context)
        call.resolve(JSObject().put("requested", true))
    }

    @PluginMethod
    fun getMeasurementSnapshot(call: PluginCall) {
        val o = JSObject()
        for ((k, v) in MeasurementManager.snapshotMap()) {
            when (v) {
                null -> o.put(k, JSObject.NULL)
                is Boolean -> o.put(k, v)
                is Long -> o.put(k, v)
                is Double -> o.put(k, v)
                is String -> o.put(k, v)
                else -> o.put(k, v.toString())
            }
        }
        call.resolve(o)
    }
}
