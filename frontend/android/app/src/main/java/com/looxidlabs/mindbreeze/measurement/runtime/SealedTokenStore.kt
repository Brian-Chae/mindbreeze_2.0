package com.looxidlabs.mindbreeze.measurement.runtime

import com.looxidlabs.mindbreeze.measurement.live.TokenStore
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 토큰을 AES-GCM 으로 봉인해 파일에 둔다. 키는 keyProvider(Android Keystore)가 준다 — 키 자체는 추출 불가.
 * 값은 로그·bridge 로 나가지 않는다. 변조·다른 키·다른 계정이면 null(크래시 없음).
 */
class SealedTokenStore(
    private val file: File,
    private val keyProvider: () -> SecretKey,
    private val account: String = "default",
) : TokenStore {
    private fun read(): JSONObject? = try {
        if (!file.exists()) null else {
            val raw = file.readBytes()
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, keyProvider(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
            c.updateAAD(account.toByteArray()) // 계정 scope 를 인증 데이터로 묶는다
            JSONObject(String(c.doFinal(raw.copyOfRange(12, raw.size))))
        }
    } catch (_: Exception) { null }

    @Synchronized override fun accessToken(): String? = read()?.optString("at")?.ifEmpty { null }
    @Synchronized override fun refreshToken(): String? = read()?.optString("rt")?.ifEmpty { null }

    @Synchronized
    override fun save(access: String?, refresh: String?) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, keyProvider())
        c.updateAAD(account.toByteArray())
        val ct = c.doFinal(JSONObject().put("at", access ?: "").put("rt", refresh ?: "").toString().toByteArray())
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        FileOutputStream(tmp).use { it.write(c.iv); it.write(ct); it.flush(); it.fd.sync() }
        tmp.renameTo(file)
    }

    @Synchronized override fun clear() { file.delete() }
}

/** 프로세스 재생성 후 복구에 필요한 비밀 아닌 설정. active=false 면 자동 재개하지 않는다(사용자 중지 존중). */
data class RuntimeConfig(
    val sessionId: String, val apiBase: String, val socketBase: String, val bandAddress: String?, val instanceId: String,
    val active: Boolean, val streamId: String? = null, val participantId: String? = null, val ownerGeneration: String? = null,
) {
    companion object {
        fun load(f: File): RuntimeConfig? = try {
            if (!f.exists()) null else JSONObject(f.readText()).let {
                RuntimeConfig(it.getString("sessionId"), it.getString("apiBase"), it.getString("socketBase"), it.optString("bandAddress").ifEmpty { null },
                    it.getString("instanceId"), it.optBoolean("active"), it.optString("streamId").ifEmpty { null },
                    it.optString("participantId").ifEmpty { null }, it.optString("ownerGeneration").ifEmpty { null })
            }
        } catch (_: Exception) { null }

        fun save(f: File, c: RuntimeConfig) {
            val o = JSONObject().put("sessionId", c.sessionId).put("apiBase", c.apiBase).put("socketBase", c.socketBase)
                .put("bandAddress", c.bandAddress ?: "").put("instanceId", c.instanceId).put("active", c.active)
                .put("streamId", c.streamId ?: "").put("participantId", c.participantId ?: "").put("ownerGeneration", c.ownerGeneration ?: "")
            val tmp = File(f.path + ".tmp")
            FileOutputStream(tmp).use { it.write(o.toString().toByteArray()); it.flush(); it.fd.sync() }
            f.parentFile?.mkdirs(); tmp.renameTo(f)
        }
    }
}
