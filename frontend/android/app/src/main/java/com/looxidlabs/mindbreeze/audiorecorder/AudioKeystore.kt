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

    /**
     * SDD-305: 녹음도 측정과 **같은 저장소**(KeystoreFactory)를 써서 단일 인증 조정자를 공유한다.
     * 예전 별도 저장소(audiorecorder/cred.bin)는 refresh 복사본을 따로 회전시켜 충돌을 만들었으므로 더는 쓰지 않는다(파일은 삭제하지 않음).
     */
    fun tokenStore(ctx: Context) = com.looxidlabs.mindbreeze.measurement.runtime.KeystoreFactory.tokenStore(ctx)
    @Suppress("unused") private fun legacyTokenStore(ctx: Context) = SealedTokenStore(File(ctx.filesDir, "audiorecorder/cred.bin"), { key() }, "audio")
    fun queueDir(ctx: Context) = File(ctx.filesDir, "audiorecorder/queue")
}
