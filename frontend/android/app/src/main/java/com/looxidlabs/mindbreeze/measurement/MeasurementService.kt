package com.looxidlabs.mindbreeze.measurement

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.looxidlabs.mindbreeze.measurement.runtime.StreamLifecycle

/** connectedDevice 포그라운드 서비스. 마이크 타입/권한을 요구하지 않는다. */
class MeasurementService : Service() {
    private val instanceId = "svc-" + System.identityHashCode(this)
    private var gatt: BandGattClient? = null
    private var synth: SyntheticSource? = null
    private val logHandler = android.os.Handler(android.os.Looper.getMainLooper())
    // native 독립 텔레메트리: JS 와 무관하게 5초마다 카운터를 logcat(MBMeas)에 남긴다(Doze 시험용).
    private val logTask = object : Runnable {
        override fun run() {
            val m = MeasurementManager.snapshotMap()
            android.util.Log.i("MBMeas", "state=${m["state"]} eeg=${m["eegPackets"]} ppg=${m["ppgPackets"]} acc=${m["accPackets"]} eegS=${m["eegSamples"]} frames=${m["frames"]} win=${m["lastWindowIndex"]} journal=${m["journalRecords"]} bytes=${m["journalBytes"]} wake=${m["wakeLockHeld"]} starts=${m["serviceStarts"]} fenced=${m["fencedCallbacks"]} synth=${m["synthetic"]}")
            logHandler.postDelayed(this, 5000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // 사용자 중지: 재개하지 않도록 active=false 를 먼저 영속화한다.
            com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig.load(java.io.File(filesDir, "measurement/runtime.json"))?.let {
                com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig.save(java.io.File(filesDir, "measurement/runtime.json"), it.copy(active = false))
            }
            teardown(); return START_NOT_STICKY
        }
        // FGS 시작 후 5초 내 startForeground 필수 — 어떤 경로든 먼저 호출한다.
        goForeground("측정 준비 중")
        // OS 가 프로세스를 죽였다 START_STICKY 로 되살린 경우(intent == null): 마지막 설정이 active 이면 같은 journal 에 이어서 재개한다.
        var resumed: Intent? = null
        if (intent == null) {
            val c = com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig.load(java.io.File(filesDir, "measurement/runtime.json"))
            if (c != null && c.active) {
                MeasurementManager.ownership.nativeEnabled = true
                resumed = Intent().putExtra(EXTRA_SESSION, c.sessionId).putExtra(EXTRA_API_BASE, c.apiBase).putExtra(EXTRA_SOCKET_BASE, c.socketBase)
                    .putExtra(EXTRA_ADDRESS, c.bandAddress).putExtra(EXTRA_INSTANCE, c.instanceId)
                    .putExtra(EXTRA_MODEL_PARAMS, c.modelParams).putExtra(EXTRA_MODEL_VERSION, c.modelVersion)
                    .putExtra(EXTRA_SYNTHETIC, c.bandAddress == null)
            } else { stopSelf(startId); return START_NOT_STICKY }
        }
        @Suppress("NAME_SHADOWING") val intent = intent ?: resumed
        if (!MeasurementManager.gate.tryStart(instanceId)) { stopSelf(startId); return START_NOT_STICKY }
        MeasurementManager.noteServiceStart()
        if (MeasurementManager.engine != null) return START_NOT_STICKY // 중복 start 멱등
        val sessionId = intent?.getStringExtra(EXTRA_SESSION)
        // debug 빌드(FLAG_DEBUGGABLE)에서만: adb 시험용으로 플래그·합성 토큰을 주입한다. release 에서는 무시된다.
        val debuggable = (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable && sessionId != null && intent.getBooleanExtra("debug_force_native", false)) {
            MeasurementManager.ownership.nativeEnabled = true
            intent.getStringExtra("debug_access")?.let { a ->
                com.looxidlabs.mindbreeze.measurement.runtime.KeystoreFactory.tokenStore(applicationContext).save(a, intent.getStringExtra("debug_refresh"))
            }
        }
        if (sessionId != null && MeasurementManager.ownership.nativeEnabled) return startNative(intent!!, sessionId)
        val address = intent?.getStringExtra(EXTRA_ADDRESS)
        val isSynthetic = intent?.getBooleanExtra(EXTRA_SYNTHETIC, false) == true
        if (address == null && !isSynthetic) { MeasurementManager.setState(MeasurementState.BLOCKED, "no_address"); teardown(); return START_NOT_STICKY }
        MeasurementManager.setState(MeasurementState.ARMING)
        val e = MeasurementManager.begin(applicationContext, isSynthetic)
        if (isSynthetic) {
            synth = SyntheticSource(applicationContext, e).also { it.start() }
        } else {
            if (!MeasurementManager.ownership.claim(BandOwnership.Owner.NATIVE)) {
                MeasurementManager.setState(MeasurementState.BLOCKED, "band_owned_by_js"); teardown(); return START_NOT_STICKY
            }
            gatt = BandGattClient(applicationContext, e, address!!) { MeasurementManager.setState(it); updateNotification(it) }.also { it.start() }
        }
        updateNotification(MeasurementState.CAPTURING)
        logHandler.removeCallbacks(logTask); logHandler.post(logTask)
        return START_NOT_STICKY
    }

    private var nativeRt: com.looxidlabs.mindbreeze.measurement.runtime.NativeRuntime? = null

    /** v2 native 경로: journal 복구 → Rust 코어 → LiveSession(Socket.IO v2)·archive. 플래그(nativeEnabled) on 일 때만 도달한다. */
    private fun startNative(intent: Intent, sessionId: String): Int {
        val cfg = com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig(
            sessionId, intent.getStringExtra(EXTRA_API_BASE) ?: "", intent.getStringExtra(EXTRA_SOCKET_BASE) ?: "",
            intent.getStringExtra(EXTRA_ADDRESS), intent.getStringExtra(EXTRA_INSTANCE) ?: java.util.UUID.randomUUID().toString(), true,
            modelParams = intent.getStringExtra(EXTRA_MODEL_PARAMS), modelVersion = intent.getStringExtra(EXTRA_MODEL_VERSION))
        val isSynthetic = intent.getBooleanExtra(EXTRA_SYNTHETIC, false)
        if (!MeasurementCore.available()) { MeasurementManager.setState(MeasurementState.BLOCKED, "core_unavailable"); teardown(); return START_NOT_STICKY }
        if (cfg.apiBase.isEmpty() || cfg.socketBase.isEmpty()) { MeasurementManager.setState(MeasurementState.BLOCKED, "bad_config"); teardown(); return START_NOT_STICKY }
        MeasurementManager.setState(MeasurementState.ARMING)
        val store = com.looxidlabs.mindbreeze.measurement.runtime.KeystoreFactory.tokenStore(applicationContext)
        val rt = com.looxidlabs.mindbreeze.measurement.runtime.NativeRuntime.open(applicationContext, cfg, store)
        com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig.save(java.io.File(filesDir, "measurement/runtime.json"), cfg)
        nativeRt = rt
        MeasurementManager.adopt(rt.engine, isSynthetic, rt)
        if (isSynthetic) { synth = SyntheticSource(applicationContext, rt.engine).also { it.start() }; rt.bandState = "connected" } // 합성 원본은 연결 상태로 보고
        else {
            if (cfg.bandAddress == null) { MeasurementManager.setState(MeasurementState.BLOCKED, "no_address"); teardown(); return START_NOT_STICKY }
            if (!MeasurementManager.ownership.claim(BandOwnership.Owner.NATIVE)) { MeasurementManager.setState(MeasurementState.BLOCKED, "band_owned_by_js"); teardown(); return START_NOT_STICKY }
            gatt = BandGattClient(applicationContext, rt.engine, cfg.bandAddress, { MeasurementManager.setState(it); rt.bandState = if (it == MeasurementState.CAPTURING) "connected" else "reconnecting"; updateNotification(it) }).also { it.start() }
        }
        rt.live.visibility = "locked"
        rt.onCaptureEnded = { status, cutoff ->
            // 서버 cutoff: 측정을 멈추고 남은 창을 봉인한다(사용자 중지와 같은 경로, active=false 로 재개 안 함). archive 업로드는 WorkManager 가 이어간다.
            StreamLifecycle.blockedReason(status, cutoff)?.let { MeasurementManager.setState(MeasurementState.BLOCKED, it) }
            stop(applicationContext)
        }
        rt.start()
        updateNotification(MeasurementState.CAPTURING)
        logHandler.removeCallbacks(logTask); logHandler.post(logTask)
        // 프로세스가 죽어도 사용자가 중지하지 않았다면 runtime.json(active=true)을 보고 다시 붙는다.
        return START_STICKY
    }

    private fun releaseResources() {
        nativeRt?.let { it.stop("user_stop"); nativeRt = null }
        logHandler.removeCallbacks(logTask)
        gatt?.stop(); gatt = null
        synth?.stop(); synth = null
        MeasurementManager.ownership.release(BandOwnership.Owner.NATIVE)
        MeasurementManager.end()
    }

    private fun teardown() {
        val blocked = MeasurementManager.state == MeasurementState.BLOCKED
        releaseResources()
        if (blocked) MeasurementManager.setState(MeasurementState.BLOCKED, MeasurementManager.blockedReason)
        MeasurementManager.gate.stopped(instanceId)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (gatt != null || synth != null) releaseResources()
        MeasurementManager.gate.stopped(instanceId)
        super.onDestroy()
    }

    private fun goForeground(text: String) {
        val n = buildNotification(text)
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        else startForeground(NOTIF_ID, n)
    }

    private fun updateNotification(s: MeasurementState) {
        val text = when (s) { MeasurementState.CAPTURING -> "측정 중"; MeasurementState.RECONNECTING -> "밴드 재연결 중"; else -> "측정 준비 중" }
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "뇌파 측정", NotificationManager.IMPORTANCE_LOW))
        }
        val stop = PendingIntent.getService(this, 1, Intent(this, MeasurementService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("MIND BREEZE").setContentText(text)
            .setSmallIcon(applicationInfo.icon).setOngoing(true).setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE).setContentIntent(open)
            .addAction(0, "측정 중지", stop).build()
    }

    companion object {
        const val ACTION_STOP = "com.looxidlabs.mindbreeze.measurement.STOP"
        const val EXTRA_ADDRESS = "address"
        const val EXTRA_SYNTHETIC = "synthetic"
        const val EXTRA_SESSION = "session_id"
        const val EXTRA_API_BASE = "api_base"
        const val EXTRA_SOCKET_BASE = "socket_base"
        const val EXTRA_INSTANCE = "instance_id"
        const val EXTRA_MODEL_PARAMS = "model_params"
        const val EXTRA_MODEL_VERSION = "model_version"
        private const val CHANNEL = "measurement"
        private const val NOTIF_ID = 24601

        fun startNative(ctx: Context, cfg: com.looxidlabs.mindbreeze.measurement.runtime.RuntimeConfig, synthetic: Boolean) {
            val i = Intent(ctx, MeasurementService::class.java).putExtra(EXTRA_ADDRESS, cfg.bandAddress).putExtra(EXTRA_SYNTHETIC, synthetic)
                .putExtra(EXTRA_SESSION, cfg.sessionId).putExtra(EXTRA_API_BASE, cfg.apiBase).putExtra(EXTRA_SOCKET_BASE, cfg.socketBase).putExtra(EXTRA_INSTANCE, cfg.instanceId)
                .putExtra(EXTRA_MODEL_PARAMS, cfg.modelParams).putExtra(EXTRA_MODEL_VERSION, cfg.modelVersion)
            androidx.core.content.ContextCompat.startForegroundService(ctx, i)
        }

        fun start(ctx: Context, address: String?, synthetic: Boolean) {
            val i = Intent(ctx, MeasurementService::class.java).putExtra(EXTRA_ADDRESS, address).putExtra(EXTRA_SYNTHETIC, synthetic)
            androidx.core.content.ContextCompat.startForegroundService(ctx, i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, MeasurementService::class.java).setAction(ACTION_STOP))
        }
    }
}
