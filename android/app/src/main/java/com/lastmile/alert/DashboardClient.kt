package com.lastmile.alert

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class DashboardClient {

    data class Station(
        val name: String,
        val river: String,
        val waterLevel: String
    )

    data class Alert(
        val id: String,
        val title: String,
        val priority: String,
        val status: String,
        // Kept for the auto-relay so the message forwarded to a phone carries
        // real backend wording instead of a hardcoded village/ETA string.
        val description: String = "",
        val instruction: String = "",
        val createdAt: String = ""
    )

    data class Evaluation(
        val riskLevel: String,
        val score: String
    )

    data class Summary(
        val stations: List<Station>,
        val alerts: List<Alert>,
        val evaluations: List<Evaluation>,
        // Real village impact for the basin of the station above. Empty when the
        // basin has no active event yet, which is an honest state, not an error.
        val impacts: List<Impact> = emptyList()
    )

    /**
     * One village row from the backend impact engine. These replace the sample
     * values the app previously rendered, so the phone shows the same
     * risk/ETA figures as the control room.
     */
    data class Impact(
        val villageId: String,
        val villageName: String,
        val riskLevel: String,
        val riskScore: Double,
        val etaMinutes: Double,
        val downstreamOrder: Int,
        val populationAtRisk: Int
    )

    /**
     * @param baseUrl backend base URL (for example
     *   `http://192.168.0.105:8000/api`). Passed in rather than read from
     *   BuildConfig so the address can be corrected on the device at runtime —
     *   the host IP changes with the Wi-Fi network, and rebuilding the APK for
     *   every new address is not practical.
     */
    fun loadSummary(baseUrl: String, onResult: (Result<Summary>) -> Unit) {
        Thread {
            val result = runCatching {
                val cleanedBaseUrl = baseUrl
                    .trim()
                    .trimEnd('/')

                if (cleanedBaseUrl.isEmpty()) {
                    error("Backend URL is empty. Enter the address shown in the API URL field.")
                }

                val response = getJson("$cleanedBaseUrl/android/overview")

                val stationsJson = response.optJSONArray("stations")
                    ?: org.json.JSONArray()

                val alertsJson = response.optJSONArray("active_alerts")
                    ?: org.json.JSONArray()

                val evaluationJson = response.optJSONObject("latest_evaluation")

                val stations = buildList {
                    for (index in 0 until stationsJson.length()) {
                        val item = stationsJson.optJSONObject(index) ?: continue
                        val reading = item.optJSONObject("latest_reading")

                        add(
                            Station(
                                name = item.optString(
                                    "station_name",
                                    "Unknown station"
                                ),
                                river = item.optString(
                                    "river_name",
                                    "Unknown river"
                                ),
                                waterLevel = reading?.optString(
                                    "water_level_m",
                                    "n/a"
                                ) ?: "n/a"
                            )
                        )
                    }
                }

                val alerts = buildList {
                    for (index in 0 until alertsJson.length()) {
                        val item = alertsJson.optJSONObject(index) ?: continue

                        add(
                            Alert(
                                id = item.optString("id", UUID.randomUUID().toString()),
                                title = item.optString(
                                    "title",
                                    "Untitled alert"
                                ),
                                priority = item.optString(
                                    "priority",
                                    "P3"
                                ),
                                status = item.optString(
                                    "status",
                                    "unknown"
                                ),
                                description = item.optString("description", ""),
                                instruction = item.optString("instruction", ""),
                                createdAt = item.optString("created_at", "")
                            )
                        )
                    }
                }

                val evaluations = buildList {
                    evaluationJson?.let { item ->
                        add(
                            Evaluation(
                                riskLevel = item.optString(
                                    "risk_level",
                                    "unknown"
                                ),
                                score = item.optString(
                                    "total_score",
                                    "n/a"
                                )
                            )
                        )
                    }
                }

                val impactsJson = response.optJSONArray("impact_assessments")
                    ?: org.json.JSONArray()

                val impacts = buildList {
                    for (index in 0 until impactsJson.length()) {
                        val item = impactsJson.optJSONObject(index) ?: continue

                        add(
                            Impact(
                                villageId = item.optString("village_id", ""),
                                villageName = item.optString(
                                    "village_name",
                                    "Unnamed village"
                                ),
                                riskLevel = item.optString(
                                    "risk_level",
                                    "unknown"
                                ),
                                riskScore = item.optDouble("risk_score", 0.0),
                                etaMinutes = item.optDouble(
                                    "time_to_impact_minutes",
                                    0.0
                                ),
                                downstreamOrder = item.optInt("downstream_order", 0),
                                populationAtRisk = item.optInt("population_at_risk", 0)
                            )
                        )
                    }
                }

                Summary(
                    stations = stations,
                    alerts = alerts,
                    evaluations = evaluations,
                    impacts = impacts.sortedBy { it.downstreamOrder }
                )
            }

            onResult(result)
        }.start()
    }

    private fun getJson(url: String): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 10_000
        }

        try {
            val responseCode = connection.responseCode
            val stream =
                if (responseCode in 200..299) {
                    connection.inputStream
                } else {
                    connection.errorStream
                }

            val responseBody =
                stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (responseCode !in 200..299) {
                error(
                    "FastAPI returned HTTP $responseCode: " +
                        responseBody.take(250)
                )
            }

            return JSONObject(responseBody)
        } catch (e: java.net.SocketTimeoutException) {
            // Most common local-network cause: the host is unreachable because
            // the phone is on a different Wi-Fi, or nothing is listening.
            error(
                "Timed out reaching $url. Check the phone and Mac are on the same " +
                    "Wi-Fi and that the backend is running on port 8000."
            )
        } catch (e: java.net.ConnectException) {
            error(
                "Cannot reach $url. Check the API URL matches the Mac's current " +
                    "address (run: ipconfig getifaddr en0)."
            )
        } catch (e: java.net.UnknownHostException) {
            error("Unknown host in $url. Use the Mac's numeric IP, not a hostname.")
        } finally {
            connection.disconnect()
        }
    }
}
