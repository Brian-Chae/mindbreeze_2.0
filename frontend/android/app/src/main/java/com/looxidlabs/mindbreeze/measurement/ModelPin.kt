package com.looxidlabs.mindbreeze.measurement

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * 활성 표준 모델(sigmoid) 1회 pin. 웹 `scoreIndices` 와 같은 규칙(활성 모델 > 코호트)을 앱에도 적용한다.
 * 수업 시작에 한 번 고정하고(파일 `model-pin.json`) 도중 교체하지 않는다. 프로세스 재생성 복구도 같은 파일을 읽는다.
 * 모델이 없으면 null → 기존 legacy_cohort 설정 그대로.
 */
data class ModelPin(val paramsJson: String, val modelVersion: String, val modelHash: String) {
    companion object {
        private val METRICS = setOf(
            "focusIndex", "relaxationIndex", "stressIndex", "totalNeuralActivity", "faa", "cognitiveLoad",
            "emotionalStability", "autonomicStability", "sdnn", "avgHeartRate", "breathingStability",
        )

        /** 검증·정규화(키 정렬, direction 정수화). 유효 지표가 하나도 없으면 null. */
        fun build(rawParams: String?, version: String?): ModelPin? {
            if (rawParams.isNullOrBlank()) return null
            val src = try { JSONObject(rawParams) } catch (_: Exception) { return null }
            val sorted = java.util.TreeMap<String, Triple<Double, Double, Int>>()
            for (k in src.keys()) {
                if (k !in METRICS) continue
                val o = src.optJSONObject(k) ?: continue
                val m = (o.opt("m") as? Number)?.toDouble() ?: continue
                val s = (o.opt("s") as? Number)?.toDouble() ?: continue
                val dir = when (val d = o.opt("direction")) { is Number -> d.toInt(); is String -> d.toIntOrNull(); else -> null } ?: continue
                if (!m.isFinite() || !s.isFinite() || s <= 0.0 || (dir != 1 && dir != -1)) continue
                sorted[k] = Triple(m, s, dir)
            }
            if (sorted.isEmpty()) return null
            val params = sorted.entries.joinToString(",", "{", "}") { (k, v) -> "\"$k\":{\"m\":${v.first},\"s\":${v.second},\"direction\":${v.third}}" }
            return ModelPin(params, versionOf(version), sha256(params))
        }

        /** 서버 `_VERSION_RE`(^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$) 를 항상 통과하는 model_version. */
        private fun versionOf(v: String?): String {
            val clean = (v ?: "").replace(Regex("[^A-Za-z0-9._+-]"), "")
            return "sigmoid-${clean.ifEmpty { "0" }}".take(64).trimEnd('-')
        }

        private fun sha256(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

        /** 코어 설정: pin 이 있으면 active_sigmoid + 모델 버전·해시, 없으면 기존 기본값(legacy_cohort). */
        fun configJson(pin: ModelPin?): String {
            if (pin == null) return MeasurementCore.DEFAULT_CONFIG
            return JSONObject(MeasurementCore.DEFAULT_CONFIG)
                .put("model_mode", "active_sigmoid").put("model_version", pin.modelVersion).put("model_hash", pin.modelHash).toString()
        }

        /** pin 파일이 있으면 그것을(교체 금지), 없고 입력 모델이 유효하면 새로 기록한다. 손상 파일은 새로 쓴다. */
        fun loadOrCreate(file: File, rawParams: String?, version: String?): ModelPin? {
            read(file)?.let { return it }
            val pin = build(rawParams, version) ?: return null
            file.parentFile?.mkdirs()
            val tmp = File(file.path + ".tmp")
            FileOutputStream(tmp).use {
                it.write(JSONObject().put("params", JSONObject(pin.paramsJson)).put("version", pin.modelVersion).put("hash", pin.modelHash).toString().toByteArray())
                it.flush(); it.fd.sync()
            }
            tmp.renameTo(file)
            return pin
        }

        private fun read(file: File): ModelPin? = try {
            if (!file.exists()) null else JSONObject(file.readText()).let {
                val params = it.getJSONObject("params").toString()
                val rebuilt = build(params, null) ?: return@let null
                if (rebuilt.modelHash != it.getString("hash")) null
                else ModelPin(rebuilt.paramsJson, it.getString("version"), it.getString("hash"))
            }
        } catch (_: Exception) { null }
    }
}
