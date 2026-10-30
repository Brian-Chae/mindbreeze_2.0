package com.looxidlabs.mindbreeze.update

import java.io.File
import java.net.URI
import java.security.MessageDigest

/** SDD-259: APK 업데이트 순수 로직(안드로이드 의존 없음 → JVM 단위 시험 가능). */
object ApkVerifier {
    /** 설치 파일을 받을 수 있는 호스트(프런트 update-config.ts 의 ALLOWED_APK_HOSTS 와 동일). */
    val ALLOWED_HOSTS: Set<String> = setOf("download.mindbreeze.looxidlabs.com")

    private val SHA256_RE = Regex("^[0-9a-fA-F]{64}$")

    fun isValidSha256(s: String): Boolean = SHA256_RE.matches(s)

    /** https + 허용 호스트만 true. */
    fun isAllowedApkUrl(url: String): Boolean = try {
        val u = URI(url)
        u.scheme == "https" && u.host != null && u.host in ALLOWED_HOSTS
    } catch (_: Exception) {
        false
    }

    fun sha256Hex(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256Matches(file: File, expected: String): Boolean =
        isValidSha256(expected) && sha256Hex(file).equals(expected, ignoreCase = true)

    /** URL 의 마지막 경로 조각에서 안전한 파일명을 만든다(경로 탈출 불가). */
    fun safeFileName(url: String): String {
        val last = try { URI(url).path.substringAfterLast('/') } catch (_: Exception) { "" }
        val cleaned = last.replace(Regex("[^A-Za-z0-9._-]"), "_").trimStart('.')
        val base = if (cleaned.isBlank()) "update.apk" else cleaned
        return if (base.endsWith(".apk")) base else "$base.apk"
    }
}
