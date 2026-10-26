package com.looxidlabs.mindbreeze.measurement.runtime

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import javax.crypto.KeyGenerator

class SealedStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test fun roundTripAndFileIsNotPlaintext() {
        val f = File(tmp.root, "cred.bin")
        val s = SealedTokenStore(f, { key })
        s.save("access-AAA", "refresh-RRR")
        assertEquals("access-AAA", SealedTokenStore(f, { key }).accessToken())
        assertEquals("refresh-RRR", SealedTokenStore(f, { key }).refreshToken())
        val raw = f.readBytes().toString(Charsets.ISO_8859_1)
        assertFalse(raw.contains("access-AAA")); assertFalse(raw.contains("refresh-RRR"))
    }

    @Test fun tamperedOrWrongKeyYieldsNullNotCrash() {
        val f = File(tmp.root, "cred.bin")
        SealedTokenStore(f, { key }).save("a", "r")
        val b = f.readBytes(); b[b.size - 1] = (b[b.size - 1].toInt() xor 1).toByte(); f.writeBytes(b)
        assertNull(SealedTokenStore(f, { key }).accessToken())
        val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        SealedTokenStore(f, { key }).save("a", "r")
        assertNull(SealedTokenStore(f, { other }).refreshToken())
    }

    @Test fun clearRemovesFile() {
        val f = File(tmp.root, "cred.bin"); val s = SealedTokenStore(f, { key })
        s.save("a", "r"); s.clear()
        assertFalse(f.exists()); assertNull(s.accessToken())
    }

    @Test fun differentAccountsDoNotShareScope() {
        val a = SealedTokenStore(File(tmp.root, "a.bin"), { key }, account = "acct-1")
        a.save("tokA", "rtA")
        val b = SealedTokenStore(File(tmp.root, "a.bin"), { key }, account = "acct-2")
        assertNull("계정 scope 가 다르면 읽지 않는다", b.accessToken())
    }

    @Test fun runtimeConfigRoundTripAndActiveFlag() {
        val f = File(tmp.root, "runtime.json")
        val c = RuntimeConfig("00000001-0000-4000-8000-000000000001", "https://api.example/api/v1", "https://api.example", "AA:BB:CC:DD:EE:FF", "00000050-0000-4000-8000-000000000050", active = true)
        RuntimeConfig.save(f, c)
        val l = RuntimeConfig.load(f)!!
        assertEquals(c, l)
        RuntimeConfig.save(f, c.copy(active = false))
        assertFalse(RuntimeConfig.load(f)!!.active)
        assertNull(RuntimeConfig.load(File(tmp.root, "none.json")))
    }
}
