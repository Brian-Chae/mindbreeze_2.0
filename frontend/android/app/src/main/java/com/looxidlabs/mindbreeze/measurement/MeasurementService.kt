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

/** connectedDevice 포그라운드 서비스. 마이크 타입/권한을 요구하지 않는다. */
class MeasurementService : Service() {
    private val instanceId = "svc-" + System.identityHashCode(this)
    private var gatt: BandGattClient? = null
    private var synth: SyntheticSource? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { teardown(); return START_NOT_STICKY }
        // FGS 시작 후 5초 내 startForeground 필수 — 어떤 경로든 먼저 호출한다.
        goForeground("측정 준비 중")
        if (!MeasurementManager.gate.tryStart(instanceId)) { stopSelf(startId); return START_NOT_STICKY }
        MeasurementManager.noteServiceStart()
        if (MeasurementManager.engine != null) return START_NOT_STICKY // 중복 start 멱등
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
        return START_NOT_STICKY
    }

    private fun releaseResources() {
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
        private const val CHANNEL = "measurement"
        private const val NOTIF_ID = 24601

        fun start(ctx: Context, address: String?, synthetic: Boolean) {
            val i = Intent(ctx, MeasurementService::class.java).putExtra(EXTRA_ADDRESS, address).putExtra(EXTRA_SYNTHETIC, synthetic)
            androidx.core.content.ContextCompat.startForegroundService(ctx, i)
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, MeasurementService::class.java).setAction(ACTION_STOP))
        }
    }
}
