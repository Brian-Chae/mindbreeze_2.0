package com.looxidlabs.mindbreeze.measurement

import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
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
    private val handler = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var gen = 0L
    private var backoffMs = 1000L
    private var stopped = false
    private val pending = ArrayDeque<BluetoothGattCharacteristic>()

    private val targets = listOf(
        Triple(Sensor.EEG, UUID.fromString(BandUuids.EEG_SERVICE), UUID.fromString(BandUuids.EEG_CHAR)),
        Triple(Sensor.PPG, UUID.fromString(BandUuids.PPG_SERVICE), UUID.fromString(BandUuids.PPG_CHAR)),
        Triple(Sensor.ACC, UUID.fromString(BandUuids.ACC_SERVICE), UUID.fromString(BandUuids.ACC_CHAR)),
    )

    fun start() { stopped = false; connect() }

    fun stop() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        engine.fence.release(gen)
        gatt?.let { it.disconnect(); it.close() }
        gatt = null
    }

    private fun connect() {
        if (stopped) return
        gatt?.close()
        gen = engine.fence.acquire()
        val myGen = gen
        val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val dev = adapter.getRemoteDevice(address)
        gatt = dev.connectGatt(ctx, false, callback(myGen), BluetoothDevice.TRANSPORT_LE)
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
                g.requestMtu(247)
            } else {
                g.close()
                if (gatt === g) gatt = null
                scheduleReconnect()
            }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            if (!engine.fence.isCurrent(myGen)) return
            g.discoverServices()
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (!engine.fence.isCurrent(myGen)) return
            pending.clear()
            for ((_, s, c) in targets) {
                g.getService(s)?.getCharacteristic(c)?.let { pending.addLast(it) }
            }
            if (pending.size < targets.size) { g.disconnect(); return }
            subscribeNext(g)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            if (!engine.fence.isCurrent(myGen)) return
            if (status != BluetoothGatt.GATT_SUCCESS) { g.disconnect(); return }
            subscribeNext(g)
        }

        @Deprecated("API 33 미만 호환")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION") dispatch(myGen, c, c.value ?: return)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            dispatch(myGen, c, value)
        }
    }

    private fun subscribeNext(g: BluetoothGatt) {
        val c = pending.removeFirstOrNull()
        if (c == null) { backoffMs = 1000L; onState(MeasurementState.CAPTURING); return }
        g.setCharacteristicNotification(c, true)
        val cccd = c.getDescriptor(UUID.fromString(BandUuids.CCCD)) ?: run { g.disconnect(); return }
        if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        else { @Suppress("DEPRECATION") cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; @Suppress("DEPRECATION") g.writeDescriptor(cccd) }
    }

    private fun dispatch(myGen: Long, c: BluetoothGattCharacteristic, bytes: ByteArray) {
        val sensor = when (c.uuid.toString()) {
            BandUuids.EEG_CHAR -> Sensor.EEG
            BandUuids.PPG_CHAR -> Sensor.PPG
            BandUuids.ACC_CHAR -> Sensor.ACC
            else -> return
        }
        engine.onNotification(myGen, sensor, bytes.copyOf())
        MeasurementManager.ensureWake(ctx)
    }
}
