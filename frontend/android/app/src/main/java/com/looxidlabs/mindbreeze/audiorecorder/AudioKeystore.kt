package com.looxidlabs.mindbreeze.audiorecorder

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.looxidlabs.mindbreeze.measurement.runtime.SealedTokenStore
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** 녹음 전용 봉인 토큰 저장소(측정 모듈 저장소와 분리 — 서로 덮어쓰지 않는다). */
object AudioKeystore {
    private const val ALIAS = "mb_audio_recorder_key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    fun tokenStore(ctx: Context) = SealedTokenStore(File(ctx.filesDir, "audiorecorder/cred.bin"), { key() }, "audio")
    fun queueDir(ctx: Context) = File(ctx.filesDir, "audiorecorder/queue")
}
