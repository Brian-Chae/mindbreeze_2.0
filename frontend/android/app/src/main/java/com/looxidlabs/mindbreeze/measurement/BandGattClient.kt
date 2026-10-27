package com.looxidlabs.mindbreeze.measurement

import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.UUID

/**
 * LINK BAND 직접 연결. callback 은 연결 세대(gen)로 fencing 되어, 재연결 후 도착한 구 콜백은 무시된다.
 * descriptor write 는 하나씩 직렬화한다.
 */
@SuppressLint("MissingPermission")
class BandGattClient(
    private val ctx: Context,
    private val engine: MeasurementEngine,
    private val address: String,
    private val onState: (MeasurementState) -> Unit,
) {
    private val TAG = "MBMeas"
    private val handler = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var gen = 0L
    private var backoffMs = 1000L
    private var stopped = false
    private val pending = ArrayList<BluetoothGattCharacteristic>()
    private var sequencer: SubscribeSequencer? = null
    private var watchdogGen = 0L
    private val watchdog = LinkWatchdog(
        post = { delay, fn -> val r = Runnable { fn() }; handler.postDelayed(r, delay); { handler.removeCallbacks(r) } },
        now = { android.os.SystemClock.elapsedRealtime() },
        onTimeout = { reason -> onLinkTimeout(watchdogGen, reason) },
    )

    private val targets = listOf(
        Triple(Sensor.EEG, UUID.fromString(BandUuids.EEG_SERVICE), UUID.fromString(BandUuids.EEG_CHAR)),
        Triple(Sensor.PPG, UUID.fromString(BandUuids.PPG_SERVICE), UUID.fromString(BandUuids.PPG_CHAR)),
        Triple(Sensor.ACC, UUID.fromString(BandUuids.ACC_SERVICE), UUID.fromString(BandUuids.ACC_CHAR)),
    )

    fun start() { stopped = false; connect() }

    fun stop() {
        stopped = true
        sequencer?.stop(); sequencer = null
        watchdog.stop()
        handler.removeCallbacksAndMessages(null)
        engine.fence.release(gen)
        gatt?.let { it.disconnect(); it.close() }
        gatt = null
    }

    private fun connect() {
        if (stopped) return
        sequencer?.stop(); sequencer = null
        watchdog.stop()
        gatt?.close()
        gen = engine.fence.acquire()
        val myGen = gen
        watchdogGen = myGen
        watchdog.armStage("connect", LinkWatchdog.CONNECT_TIMEOUT_MS)
        val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val dev = adapter.getRemoteDevice(address)
        gatt = dev.connectGatt(ctx, false, callback(myGen), BluetoothDevice.TRANSPORT_LE)
    }

    /** 워치독 타임아웃: 현재 세대일 때만 링크를 닫고 기존 재연결 경로(백오프·gen fence)를 탄다. */
    private fun onLinkTimeout(timeoutGen: Long, reason: String) {
        if (stopped || !engine.fence.isCurrent(timeoutGen)) return
        Log.w(TAG, "link watchdog: $reason — reconnect")
        watchdog.stop()
        sequencer?.stop(); sequencer = null
        gatt?.let { it.disconnect(); it.close() }
        gatt = null
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (stopped) return
        onState(MeasurementState.RECONNECTING)
        engine.counters.reconnected()
        handler.postDelayed({ connect() }, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
    }

    private fun callback(myGen: Long) = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            if (!engine.fence.isCurrent(myGen)) { g.close(); return }
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                watchdog.armStage("mtu", LinkWatchdog.MTU_TIMEOUT_MS)
                // requestMtu 가 거절(false)되면 onMtuChanged 가 오지 않는다 → 서비스 발견으로 바로 진행한다.
                if (!g.requestMtu(247)) { Log.w(TAG, "requestMtu rejected — discoverServices"); startDiscovery(g) }
            } else {
                watchdog.stop()
                g.close()
                if (gatt === g) gatt = null
                scheduleReconnect()
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            if (!engine.fence.isCurrent(myGen)) return
            Log.i(TAG, "mtu changed mtu=$mtu status=$status")  // status 실패여도 기본 MTU 로 진행한다
            startDiscovery(g)
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (!engine.fence.isCurrent(myGen)) return
            watchdog.stageDone()
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.w(TAG, "services discovery failed status=$status")
                onLinkTimeout(myGen, "discover_status:$status")
                return
            }
            pending.clear()
            for ((_, s, c) in targets) {
                g.getService(s)?.getCharacteristic(c)?.let { pending.add(it) }
            }
            Log.i(TAG, "services discovered: ${pending.size}/${targets.size} characteristics")
            if (pending.size < targets.size) { onLinkTimeout(myGen, "missing_characteristics"); return }
            watchdog.armStage("subscribe", LinkWatchdog.SUBSCRIBE_TIMEOUT_MS)
            subscribeAll(g, myGen)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (!engine.fence.isCurrent(myGen)) return
            Log.i(TAG, "cccd written ${d.characteristic.uuid} status=$status")
            sequencer?.onWritten(status == BluetoothGatt.GATT_SUCCESS)
        }

        @Deprecated("API 33 미만 호환")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION") dispatch(myGen, c, c.value ?: return)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            dispatch(myGen, c, value)
        }
    }

    /**
     * EEG→PPG→ACC CCCD 를 하나씩 쓴다. 이전 구현은 writeDescriptor 반환값(false=GATT 바쁨)을 무시해 EEG 만 붙고 큐가 멈췄다.
     * 거절은 재시도, 무응답은 워치독으로 끊어 재연결 경로(gen fencing)를 탄다.
     */
    private fun subscribeAll(g: BluetoothGatt, myGen: Long) {
        sequencer?.stop()
        val chars = ArrayList(pending)
        sequencer = SubscribeSequencer(
            count = chars.size,
            write = { i -> writeCccd(g, chars[i]) },
            post = { delay, fn -> val r = Runnable { if (engine.fence.isCurrent(myGen)) fn() }; handler.postDelayed(r, delay); { handler.removeCallbacks(r) } },
            onDone = { Log.i(TAG, "all subscribed"); backoffMs = 1000L; watchdog.stageDone(); watchdog.startSilence(); onState(MeasurementState.CAPTURING) },
            onFail = { reason -> Log.w(TAG, "subscribe failed: $reason"); if (engine.fence.isCurrent(myGen)) g.disconnect() },
        ).also { it.start() }
    }

    /** onMtuChanged / requestMtu 거절 / 둘 다 안 오는 경우(워치독)에서 서비스 발견을 정확히 한 번 시작한다. */
    private fun startDiscovery(g: BluetoothGatt) {
        watchdog.armStage("discover", LinkWatchdog.DISCOVER_TIMEOUT_MS)
        if (!g.discoverServices()) { Log.w(TAG, "discoverServices rejected"); onLinkTimeout(watchdogGen, "discover_rejected") }
    }

    private fun writeCccd(g: BluetoothGatt, c: BluetoothGattCharacteristic): Boolean {
        g.setCharacteristicNotification(c, true)
        val cccd = c.getDescriptor(UUID.fromString(BandUuids.CCCD)) ?: return false
        val ok = if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
        else { @Suppress("DEPRECATION") cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; @Suppress("DEPRECATION") g.writeDescriptor(cccd) }
        Log.i(TAG, "cccd write ${c.uuid} accepted=$ok")
        return ok
    }

    private fun dispatch(myGen: Long, c: BluetoothGattCharacteristic, bytes: ByteArray) {
        val sensor = when (c.uuid.toString()) {
            BandUuids.EEG_CHAR -> Sensor.EEG
            BandUuids.PPG_CHAR -> Sensor.PPG
            BandUuids.ACC_CHAR -> Sensor.ACC
            else -> return
        }
        if (engine.fence.isCurrent(myGen)) watchdog.touch()
        engine.onNotification(myGen, sensor, bytes.copyOf())
        MeasurementManager.ensureWake(ctx)
    }
}
