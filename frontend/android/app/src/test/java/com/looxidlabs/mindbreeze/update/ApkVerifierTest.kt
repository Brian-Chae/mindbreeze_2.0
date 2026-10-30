package com.looxidlabs.mindbreeze.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ApkVerifierTest {
    // "abc" 의 SHA-256
    private val abcSha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

    private fun tmp(content: String): File = File.createTempFile("apk", ".bin").apply { writeText(content); deleteOnExit() }

    @Test fun sha256_일치_불일치_대소문자() {
        val f = tmp("abc")
        assertTrue(ApkVerifier.sha256Matches(f, abcSha))
        assertTrue(ApkVerifier.sha256Matches(f, abcSha.uppercase()))
        assertFalse(ApkVerifier.sha256Matches(f, "0".repeat(64)))
        assertFalse(ApkVerifier.sha256Matches(f, "short"))
    }

    @Test fun 허용_URL() {
        assertTrue(ApkVerifier.isAllowedApkUrl("https://download.mindbreeze.looxidlabs.com/a.apk"))
        assertFalse(ApkVerifier.isAllowedApkUrl("http://download.mindbreeze.looxidlabs.com/a.apk"))
        assertFalse(ApkVerifier.isAllowedApkUrl("https://evil.example.com/a.apk"))
        assertFalse(ApkVerifier.isAllowedApkUrl("https://download.mindbreeze.looxidlabs.com.evil.com/a.apk"))
        assertFalse(ApkVerifier.isAllowedApkUrl("not a url"))
    }

    @Test fun 파일명_경로탈출_불가() {
        assertEquals("a.apk", ApkVerifier.safeFileName("https://download.mindbreeze.looxidlabs.com/x/a.apk"))
        assertEquals("update.apk", ApkVerifier.safeFileName("https://download.mindbreeze.looxidlabs.com/"))
        assertFalse(ApkVerifier.safeFileName("https://h/..%2F..%2Fetc/passwd").contains("/"))
        assertTrue(ApkVerifier.safeFileName("https://h/x").endsWith(".apk"))
        assertFalse(ApkVerifier.safeFileName("https://h/.hidden.apk").startsWith("."))
    }
}
