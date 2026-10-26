package com.looxidlabs.mindbreeze.measurement

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.looxidlabs.mindbreeze.measurement.bridge.BridgeModel
import com.looxidlabs.mindbreeze.measurement.runtime.BatteryPolicy
import com.looxidlabs.mindbreeze.measurement.runtime.KeystoreFactory
import com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig
import org.json.JSONObject
import java.util.UUID

/**
 * WebView 는 조회·시작·중지·명령 전달만 한다. 수집·journal·프레임·소켓·업로드는 Service(NativeRuntime) 소유.
 * 이벤트는 foreground 일 때만 1초 배치로 emit 하며 raw 샘플·토큰·서명 URL 은 절대 싣지 않는다.
 * 기능 플래그(setNativeOwnership enabled) 기본 off — off 면 기존 spike/JS 경로 그대로.
 */
@CapacitorPlugin(name = "NativeMeasurement")
class MeasurementPlugin : Plugin() {
    private val ui = Handler(Looper.getMainLooper())
    @Volatile private var foreground = true
    private var emitting = false
    private var lastRequestId: String? = null
    private var lastStart: JSObject? = null

    private val emitTask = object : Runnable {
        override fun run() {
            emitBatch()
            if (emitting) ui.postDelayed(this, 1000)
        }
    }

    override fun handleOnStart() { foreground = true; startEmit() }
    /** 사용자가 설정 화면에서 돌아오면 배터리 최적화 상태를 다시 읽어 바뀌었을 때만 알린다(읽기만, 변경하지 않음). */
    override fun handleOnResume() {
        val now = BatteryPolicy.read(context)
        val prev = lastBattery
        lastBattery = now.toString()
        if (prev != null && prev != lastBattery) notifyListeners("batteryOptimizationChanged", JSObject(lastBattery))
    }
    private var lastBattery: String? = null
    override fun handleOnStop() { foreground = false }
    override fun handleOnDestroy() { emitting = false; ui.removeCallbacks(emitTask) }

    private fun startEmit() { if (!emitting) { emitting = true; ui.postDelayed(emitTask, 1000) } }

    private fun json(o: JSONObject): JSObject = JSObject(o.toString())

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("bridge_version", 1); put("platform", "android"); put("os_version", Build.VERSION.RELEASE ?: "")
            put("native_runtime_version", "native-1.0.0"); put("core_version", if (MeasurementCore.available()) "core-1.0.0" else JSONObject.NULL)
            put("live_protocol_versions", org.json.JSONArray().put(2)); put("device_profiles", org.json.JSONArray().put("linkband2-v1"))
            put("background", JSObject().put("capture", "supported").put("live_socket", "supported").put("archive_upload", "supported"))
            put("permissions", JSObject().put("bluetooth", "granted").put("notifications", "granted").put("microphone", "not_required"))
            put("nativeMeasurement", true); put("spike", false)
            put("rustCore", MeasurementCore.available()); put("nativeEnabled", MeasurementManager.ownership.nativeEnabled)
            put("platform_detail", "android")
            put("foregroundServiceType", "connectedDevice"); put("microphoneRequired", false)
            put("batteryOptimization", BatteryPolicy.read(context).getString("batteryOptimization"))
        })
    }

    @PluginMethod
    fun setNativeOwnership(call: PluginCall) {
        MeasurementManager.ownership.nativeEnabled = call.getBoolean("enabled", false) == true
        call.resolve(JSObject().put("enabled", MeasurementManager.ownership.nativeEnabled))
    }

    /** 인증 인계: 웹이 가진 access/refresh 를 native Keystore 저장소로 1회 옮긴다. 이후 갱신은 native 가 소유하며 값은 어떤 이벤트로도 돌려보내지 않는다. */
    @PluginMethod
    fun handoffCredentials(call: PluginCall) {
        val at = call.getString("accessToken"); val rt = call.getString("refreshToken")
        if (at.isNullOrEmpty() && rt.isNullOrEmpty()) { call.reject("credential_missing"); return }
        KeystoreFactory.tokenStore(context).save(at, rt)
        call.resolve(json(BridgeModel.handoffResult(saved = true)))
    }

    @PluginMethod
    fun startMeasurement(call: PluginCall) {
        val synthetic = call.getBoolean("synthetic", false) == true
        val address = call.getString("address")
        val sessionId = call.getString("sessionId")
        if (sessionId != null) {
            // v2 native 파이프라인 — 기능 플래그 on 일 때만. 같은 requestId 재호출은 멱등(새 수집을 시작하지 않는다).
            if (!MeasurementManager.ownership.nativeEnabled) { call.reject("native_ownership_disabled"); return }
            val requestId = call.getString("requestId")
            val st = MeasurementManager.state
            if (requestId != null && requestId == lastRequestId && st != MeasurementState.CLOSED && st != MeasurementState.IDLE) {
                call.resolve(JSObject(((lastStart ?: JSObject()).toString())).put("idempotentReplay", true)); return
            }
            val apiBase = call.getString("apiBase"); val socketBase = call.getString("socketBase")
            if (apiBase.isNullOrEmpty() || socketBase.isNullOrEmpty()) { call.reject("bad_config"); return }
            if (address == null && !synthetic) { call.reject("address_required"); return }
            val cfg = RuntimeConfig(sessionId, apiBase, socketBase, address, call.getString("instanceId") ?: UUID.randomUUID().toString(), true,
                modelParams = call.getString("modelParams"), modelVersion = call.getString("modelVersion"))
            MeasurementService.startNative(context, cfg, synthetic)
            lastRequestId = requestId
            val res = JSObject().put("managerId", UUID.randomUUID().toString()).put("streamId", JSONObject.NULL).put("ownerGeneration", JSONObject.NULL)
                .put("managerGeneration", "1").put("state", "ARMING").put("idempotentReplay", false)
            lastStart = res; startEmit(); call.resolve(res); return
        }
        // 기존 spike 경로(sessionId 없음): 합성은 플래그 없이도 허용(기존 동작 유지)
        if (!synthetic && !MeasurementManager.ownership.nativeEnabled) { call.reject("native_ownership_disabled"); return }
        if (address == null && !synthetic) { call.reject("address_required"); return }
        MeasurementService.start(context, address, synthetic)
        call.resolve(JSObject().put("requested", true))
    }

    @PluginMethod
    fun stopMeasurement(call: PluginCall) {
        MeasurementService.stop(context)
        call.resolve(JSObject().put("seal_started", true).put("state", "SEALING").put("note", "seal_started_is_not_archive_complete").put("requested", true))
    }

    @PluginMethod
    fun dispatchLiveCommand(call: PluginCall) {
        val rt = MeasurementManager.runtime
        if (rt == null) { call.reject("not_running"); return }
        val cmd = JSONObject(call.data.toString())
        val id = cmd.optString("command_id").ifEmpty { null }
        if (id == null) { call.reject("command_id_required"); return }
        rt.sched.post { rt.live.dispatch(cmd) }
        call.resolve(JSObject().put("command_id", id).put("accepted_for_send", true).put("queued_at_native_ms", System.currentTimeMillis()))
    }

    @PluginMethod
    fun getMeasurementSnapshot(call: PluginCall) {
        val rt = MeasurementManager.runtime
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
        // 계약 MeasurementSnapshot(bridge) 밖의 진단 필드: 배터리 최적화 상태·live 격리 수(T01 계약 반영 전까지 최상위에 둔다)
        o.put("batteryOptimization", json(BatteryPolicy.read(context)))
        if (rt != null) o.put("liveQuarantined", rt.box.quarantined())
        if (rt != null) o.put("bridge", json(BridgeModel.snapshot(rt.inputs(MeasurementManager.state.name, MeasurementManager.blockedReason))))
        call.resolve(o)
    }

    /**
     * 기기 시트 원시 파형 미리보기(시트가 열려 있을 때만 JS 가 1초 폴링). 입력 {seconds?, points?}.
     * 결과는 {eegFp1, eegFp2, ppgRed, ppgIr} 숫자 배열뿐 — 토큰·원문 바이트·URL 은 싣지 않는다. 측정 중이 아니면 빈 배열.
     */
    @PluginMethod
    fun getRawPreview(call: PluginCall) {
        val points = (call.getInt("points") ?: 120).coerceIn(2, 500)
        val p = MeasurementManager.engine?.rawPreview(points)
        fun arr(l: List<Double>?) = org.json.JSONArray().also { a -> l?.forEach { a.put(it) } }
        call.resolve(JSObject().put("eegFp1", arr(p?.eegFp1)).put("eegFp2", arr(p?.eegFp2)).put("ppgRed", arr(p?.ppgRed)).put("ppgIr", arr(p?.ppgIr)))
    }

    /** 배터리 최적화 상태 읽기(측정 시작 전 안내용). {batteryOptimization: exempt|optimized|restricted|unknown, backgroundRestricted, vendorPolicy, settingsTargets} */
    @PluginMethod
    fun getBatteryOptimization(call: PluginCall) {
        val s = BatteryPolicy.read(context); lastBattery = s.toString()
        call.resolve(json(s))
    }

    /**
     * 사용자가 직접 "제한 없음"을 고르도록 설정 화면을 연다. 예외를 자동으로 걸지 않으며 직접 요청 다이얼로그(REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)도 쓰지 않는다.
     * 입력 {target?: "app_details"|"battery_optimization_list"}, 결과 {opened, target}.
     */
    @PluginMethod
    fun openBatteryOptimizationSettings(call: PluginCall) {
        val host: android.content.Context = activity ?: context
        for (t in BatteryPolicy.settingsTargets(call.getString("target"))) {
            val i = Intent(t.action)
            if (t.withPackageUri) i.data = Uri.parse("package:" + context.packageName)
            if (host !is Activity) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { host.startActivity(i); call.resolve(JSObject().put("opened", true).put("target", t.id)); return }
            catch (_: ActivityNotFoundException) { } catch (_: SecurityException) { }
        }
        call.resolve(JSObject().put("opened", false).put("target", JSObject.NULL))
    }

    /** foreground 에서만: commandAck → liveStateUpdated → measurementUpdated(전체 snapshot) → archiveStatus 순 batch emit. raw 전량은 보내지 않는다. */
    private fun emitBatch() {
        if (!foreground) return
        val rt = MeasurementManager.runtime ?: return
        val now = System.currentTimeMillis()
        val gen = rt.sequencer.managerGeneration
        fun send(name: String, payload: JSONObject) {
            notifyListeners(name, JSObject(BridgeModel.event(name, gen, rt.sequencer.next(), now, payload).toString()))
        }
        val st = MeasurementManager.state.name; val br = MeasurementManager.blockedReason
        val acks = ArrayList<JSONObject>(); rt.live.acks.drainTo(acks)
        for (a in acks) send("commandAck", a)
        val evs = ArrayList<JSONObject>(); rt.live.events.drainTo(evs)
        for (e in evs) if (e.has("event_id")) send("liveStateUpdated", BridgeModel.liveStatePayload(rt.cfg.sessionId, e))
        val inputs = rt.inputs(st, br)
        send("measurementUpdated", BridgeModel.snapshot(inputs))
        send("archiveStatus", BridgeModel.archiveStatusPayload(rt.cfg.sessionId, BridgeModel.queue(inputs), null,
            rt.lastArchiveStage?.takeIf { it in setOf("presign", "put", "verify") }, rt.lastArchiveCode))
    }
}
