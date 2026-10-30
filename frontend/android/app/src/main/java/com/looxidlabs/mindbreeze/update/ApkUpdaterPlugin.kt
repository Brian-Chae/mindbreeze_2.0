package com.looxidlabs.mindbreeze.update

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * SDD-259: 다운로드 사이트 APK 를 앱 안에서 받아 sha256 검증 후 시스템 설치 화면을 연다.
 * REQUEST_INSTALL_PACKAGES 권한은 sideload 빌드(-PmbSideload=true)에만 들어간다.
 * 권한이 없는 빌드(Play 제출용)는 installSupported=false 를 보고하고 설치를 거부한다.
 */
@CapacitorPlugin(name = "ApkUpdater")
class ApkUpdaterPlugin : Plugin() {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    private val cancelled = AtomicBoolean(false)
    private val running = AtomicBoolean(false)

    /** 매니페스트에 권한이 선언돼 있는지(sideload 빌드). */
    private fun installSupported(): Boolean = try {
        val info = context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(android.Manifest.permission.REQUEST_INSTALL_PACKAGES) == true
    } catch (_: Exception) {
        false
    }

    private fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    @PluginMethod
    fun getInstallCapability(call: PluginCall) {
        val r = JSObject()
        r.put("installSupported", installSupported())
        r.put("canInstall", installSupported() && canInstall())
        call.resolve(r)
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        if (!installSupported()) { call.reject("not_supported", "not_supported"); return }
        try {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
            call.resolve()
        } catch (e: Exception) {
            call.reject("install_failed", "install_failed")
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cancelled.set(true)
        call.resolve()
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url") ?: ""
        val sha = call.getString("sha256") ?: ""
        if (!installSupported()) { call.reject("not_supported", "not_supported"); return }
        if (!ApkVerifier.isAllowedApkUrl(url) || !ApkVerifier.isValidSha256(sha)) { call.reject("bad_request", "bad_request"); return }
        if (!canInstall()) { call.reject("permission_required", "permission_required"); return }
        if (!running.compareAndSet(false, true)) { call.reject("download_failed", "already_running"); return }
        cancelled.set(false)
        val expectedSize = call.getLong("sizeBytes") ?: 0L
        Thread {
            var out: File? = null
            try {
                val dir = File(context.cacheDir, "updates").apply { mkdirs() }
                // 이전 시도의 잔여 파일 정리
                dir.listFiles()?.forEach { it.delete() }
                val target = File(dir, ApkVerifier.safeFileName(url))
                out = target
                download(url, target, expectedSize)
                if (!ApkVerifier.sha256Matches(target, sha)) {
                    target.delete()
                    call.reject("hash_mismatch", "hash_mismatch")
                    return@Thread
                }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
                val intent = Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                val r = JSObject()
                r.put("status", "installing")
                call.resolve(r)
            } catch (e: Exception) {
                out?.delete()
                call.reject("download_failed", "download_failed")
            } finally {
                running.set(false)
            }
        }.start()
    }

    private fun download(url: String, target: File, expectedSize: Long) {
        client.newCall(Request.Builder().url(url).build()).execute().use { res ->
            if (!res.isSuccessful) throw IllegalStateException("http ${res.code}")
            val body = res.body ?: throw IllegalStateException("empty body")
            val total = if (body.contentLength() > 0) body.contentLength() else expectedSize
            var received = 0L
            var lastEmit = 0L
            body.byteStream().use { input ->
                target.outputStream().use { output ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled.get()) throw IllegalStateException("cancelled")
                        val n = input.read(buf)
                        if (n < 0) break
                        output.write(buf, 0, n)
                        received += n
                        val now = System.currentTimeMillis()
                        if (now - lastEmit >= 200) {
                            lastEmit = now
                            val e = JSObject()
                            e.put("received", received)
                            e.put("total", total)
                            notifyListeners("progress", e)
                        }
                    }
                }
            }
            val e = JSObject()
            e.put("received", received)
            e.put("total", if (total > 0) total else received)
            notifyListeners("progress", e)
        }
    }
}
