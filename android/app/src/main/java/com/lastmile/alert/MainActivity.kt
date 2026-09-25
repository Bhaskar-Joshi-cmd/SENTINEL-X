package com.lastmile.alert

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import android.widget.TextView
import android.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import java.nio.charset.StandardCharsets
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private lateinit var connections: ConnectionsClient
    private lateinit var statusText: TextView
    private lateinit var alertsText: TextView
    private lateinit var dashboardUrlInput: EditText
    private lateinit var dashboardStatusText: TextView
    private lateinit var roleText: TextView
    private lateinit var workspaceText: TextView
    private lateinit var roleContent: LinearLayout
    private lateinit var emergencyStore: EmergencyStore
    private lateinit var dashboardClient: DashboardClient
    private var dashboardSummary: DashboardClient.Summary? = null

    // Auto-refresh so the app tracks the same 10s cadence as the web stream.
    // Previously loadSummary() ran only once in onCreate(), so the app froze at
    // its launch values and could never agree with the live dashboard.
    private val dashboardHandler = Handler(Looper.getMainLooper())
    private var dashboardRefreshScheduled = false
    private var dashboardRequestInFlight = false

    // -----------------------------------------------------------------------
    // Auto-relay: backend decision -> phone-to-phone relay.
    //
    // The rule engine only creates an alert once the score reaches 70 (high) or
    // 85 (critical), so "a new dispatchable alert appeared" is the threshold
    // trigger. We relay the newest alert once, remember its id, and ignore every
    // later poll until a different alert shows up. Manual "Send relay alert"
    // still works independently for operator override / retry.
    // -----------------------------------------------------------------------
    private var lastAutoRelayAlertId: String? = null
    private var autoRelayEnabled = true
    private val dashboardRefreshRunnable = object : Runnable {
        override fun run() {
            dashboardRefreshScheduled = false
            if (isFinishing || isDestroyed) return
            connectToDashboard(silent = true)
            scheduleDashboardRefresh()
        }
    }
    private val connectedEndpoints = mutableSetOf<String>()
    private val endpointNames = mutableMapOf<String, String>()
    private val receivedAlertIds = mutableSetOf<String>()
    private val strategy = Strategy.P2P_CLUSTER
    private val serviceId = "com.lastmile.alert.RELAY"
    private val notificationChannel = "lastmile-alerts"
    private var relayStarted = false
    private val defaultChainHops = 106
    private lateinit var session: SessionStore.Session

    private companion object {
        // Matches the web dashboard's 10s stream cadence so both surfaces
        // converge on the same reading at roughly the same time.
        const val DASHBOARD_REFRESH_MS = 10_000L
    }

    private val lifecycleCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: com.google.android.gms.nearby.connection.ConnectionInfo) {
            endpointNames[endpointId] = info.endpointName
            connections.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (result.status.isSuccess) {
                connectedEndpoints.add(endpointId)
                updateStatus("Relay active / ${connectedEndpoints.size} nearby node(s)")
            }
        }

        override fun onDisconnected(endpointId: String) {
            connectedEndpoints.remove(endpointId)
            endpointNames.remove(endpointId)
            updateStatus("Relay active / ${connectedEndpoints.size} nearby node(s)")
        }
    }

    private val discoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            connections.requestConnection(deviceName(), endpointId, lifecycleCallback)
        }

        override fun onEndpointLost(endpointId: String) = Unit
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val message = payload.asBytes()?.toString(StandardCharsets.UTF_8) ?: return
            receiveAndRelay(message, endpointId)
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        emergencyStore = EmergencyStore(this)
        dashboardClient = DashboardClient()
        session = SessionStore.Session("demo", "Demo Operator", "control_room")
        connections = Nearby.getConnectionsClient(this)
        statusText = findViewById(R.id.statusText)
        alertsText = findViewById(R.id.alertsText)
        dashboardUrlInput = findViewById(R.id.dashboardUrlInput)
        dashboardUrlInput.setText(BuildConfig.DASHBOARD_API_URL)
        dashboardStatusText = findViewById(R.id.dashboardStatusText)
        roleText = findViewById(R.id.roleText)
        workspaceText = findViewById(R.id.workspaceText)
        findViewById<TextView>(R.id.userText).text = "${session.displayName} / ${session.username}"
        roleText.text = session.role.replace('_', ' ').uppercase()
        workspaceText.text = workspaceFor(session.role)
        roleContent = findViewById(R.id.roleContent)
        renderRoleWorkspace(session)
        createNotificationChannel()

        val roles = listOf(
            "control_room" to "Control room",
            "disaster_authority" to "Disaster authority",
            "village_authority" to "Village authority",
            "community_member" to "Community member",
            "admin" to "System admin"
        )
        val roleSelector = findViewById<Spinner>(R.id.roleSelector)
        roleSelector.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            roles.map { it.second }
        )
        roleSelector.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val selectedRole = roles[position].first
                if (selectedRole == session.role) return
                session = session.copy(role = selectedRole)
                roleText.text = selectedRole.replace('_', ' ').uppercase()
                workspaceText.text = workspaceFor(selectedRole)
                renderRoleWorkspace(session)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }

        findViewById<Button>(R.id.relayButton).setOnClickListener { requestPermissionsAndStart() }
        findViewById<Button>(R.id.sendButton).setOnClickListener { sendDemoAlert() }
        findViewById<Button>(R.id.dashboardButton).setOnClickListener { connectToDashboard() }
        connectToDashboard()
        scheduleDashboardRefresh()
    }

    override fun onDestroy() {
        cancelDashboardRefresh()
        super.onDestroy()
    }

    private fun workspaceFor(role: String): String = when (role) {
        "control_room" -> "Operational command / alert approval / network twin"
        "disaster_authority" -> "Regional situation / approval queue / delivery oversight"
        "village_authority" -> "Japisagiya Gaon / local warning / community reporting"
        "community_member" -> "Emergency information / active warnings / acknowledgement"
        else -> "System administration / account oversight / relay health"
    }

    private fun scheduleDashboardRefresh() {
        if (dashboardRefreshScheduled || isFinishing || isDestroyed) return
        dashboardRefreshScheduled = true
        dashboardHandler.postDelayed(dashboardRefreshRunnable, DASHBOARD_REFRESH_MS)
    }

    private fun cancelDashboardRefresh() {
        dashboardRefreshScheduled = false
        dashboardHandler.removeCallbacks(dashboardRefreshRunnable)
    }

    // `silent` is used by the 10s auto-refresh so the status line does not flash
    // "connecting..." every cycle. A manual tap still shows progress, and errors
    // are always surfaced.
    private fun connectToDashboard(silent: Boolean = false) {
        if (dashboardRequestInFlight) return
        dashboardRequestInFlight = true

        val button = findViewById<Button>(R.id.dashboardButton)
        if (!silent) {
            button.isEnabled = false
            dashboardStatusText.text = "FastAPI: connecting..."
        }
        // Read the URL from the field so it can be corrected on the device. The
        // Mac's address changes whenever it joins a different network, and
        // rebuilding the APK each time is impractical.
        val requestedUrl = dashboardUrlInput.text.toString().trim()
        dashboardClient.loadSummary(requestedUrl) { result ->
            runOnUiThread {
                dashboardRequestInFlight = false
                if (!isFinishing && !isDestroyed) {
                    button.isEnabled = true
                }
                result.onSuccess { summary ->
                    dashboardSummary = summary
                    dashboardStatusText.text = if (summary.stations.isEmpty() && summary.alerts.isEmpty() && summary.evaluations.isEmpty()) {
                        "FastAPI: connected, but no dashboard rows were returned"
                    } else {
                        "FastAPI: connected / ${summary.stations.size} stations / ${summary.alerts.size} alerts / $requestedUrl"
                    }
                    // A fresh, severe backend alert is the automatic relay
                    // trigger. Runs after the UI render so the dashboard always
                    // updates first.
                    maybeAutoRelay(summary)
                    renderRoleWorkspace(session)
                }.onFailure { error ->
                    // On a background tick a single failure should surface but
                    // must not kill the loop; the next tick retries. Echo the URL
                    // that was attempted so a wrong address is obvious.
                    dashboardStatusText.text = "FastAPI: failed / ${error.message ?: "unknown error"} / tried $requestedUrl"
                }
            }
        }
    }

    /**
     * Fires the phone-to-phone relay when the backend produces a new alert that
     * is severe enough to dispatch. Called after every successful dashboard
     * poll; the [lastAutoRelayAlertId] guard makes it idempotent, so a 10s poll
     * loop does not re-send the same warning to the chain.
     */
    private fun maybeAutoRelay(summary: DashboardClient.Summary) {
        if (!autoRelayEnabled) return

        val alert = summary.alerts.firstOrNull() ?: return
        if (!isDispatchable(alert)) return

        // Idempotent: the same backend alert must reach the chain only once,
        // otherwise the 10s poll loop would re-broadcast it forever.
        if (alert.id == lastAutoRelayAlertId) return
        lastAutoRelayAlertId = alert.id

        val station = summary.stations.firstOrNull()
        val location = when {
            station == null -> "monitored basin"
            station.river.isNotBlank() -> "${station.river} / ${station.name}"
            else -> station.name
        }
        val body = alert.instruction.ifBlank {
            alert.description.ifBlank { "Follow local disaster-management instructions." }
        }

        // 7-part wire format matches receiveAndRelay()/forwardToNextHop():
        // id | priority | hazard | location | message | hopsRemaining | visitedNames
        val message = buildString {
            append(alert.id).append('|')
            append(alert.priority).append('|')
            append("FLASH FLOOD").append('|')
            append(location.replace('|', ' ')).append('|')
            append(body.replace('|', ' ')).append('|')
            append(defaultChainHops).append('|')
            append(deviceName())
        }

        updateStatus("Auto relay: new ${alert.priority} alert from backend")
        receiveAndRelay(message, null)
    }

    /**
     * The rule engine's alert threshold is 70 (high). Anything lower is
     * monitoring-only and must not reach a phone automatically, which is why
     * only P0/P1 (and their critical/high severities) are dispatchable.
     */
    private fun isDispatchable(alert: DashboardClient.Alert): Boolean {
        val priority = alert.priority.uppercase()
        if (priority == "P0" || priority == "P1") return true
        val severity = alert.status.lowercase()
        return severity.contains("critical") || severity.contains("high")
    }

    private fun renderRoleWorkspace(session: SessionStore.Session) {
        roleContent.removeAllViews()
        when (session.role) {
            "control_room" -> renderControlRoom(session)
            "disaster_authority" -> renderDisasterAuthority(session)
            "village_authority" -> renderVillageAuthority(session)
            "community_member" -> renderCommunityMember(session)
            else -> renderSystemAdmin(session)
        }
    }

    private fun renderControlRoom(session: SessionStore.Session) {
        val data = dashboardSummary
        val station = data?.stations?.firstOrNull()
        val evaluation = data?.evaluations?.firstOrNull()

        // The one thing an operator must not have to hunt for: the current band.
        addRiskBanner(
            riskLevel = evaluation?.riskLevel ?: "normal",
            headline = bandLabel(evaluation?.riskLevel),
            detail = if (data == null) "No data loaded" else "${station?.river ?: "Unknown river"} · ${station?.name ?: "No station"}",
        )

        addLabel("Current situation")
        addMetric("Water level", station?.waterLevel ?: "—")
        addMetric("Active alerts", "${data?.alerts?.size ?: 0}")
        addMetric("Risk score", evaluation?.score ?: "—")

        val pending = emergencyStore.pendingAlerts().firstOrNull()
        val remoteAlert = data?.alerts?.firstOrNull()

        addLabel("Alert queue")
        // The remote alert and the local pending alert are different types, so
        // they are rendered separately rather than merged.
        when {
            remoteAlert != null -> addCard("${remoteAlert.title}\n${remoteAlert.priority} · ${remoteAlert.status}")
            pending != null -> addCard("${pending.title}\n${pending.severity} · ${pending.village}\n${pending.message}")
            else -> addCard("No alerts waiting.")
        }
        pending?.let { alert ->
            addPrimaryAction("Approve warning") {
                emergencyStore.updateAlertStatus(alert.id, "APPROVED", session.username)
                updateStatus("Warning approved and queued for relay")
                renderRoleWorkspace(session)
            }
            addSecondaryAction("Reject / dismiss") {
                emergencyStore.updateAlertStatus(alert.id, "DISMISSED", session.username)
                updateStatus("Warning dismissed")
                renderRoleWorkspace(session)
            }
        }

        addLabel("Villages at risk")
        // Sample values stand in for the impact engine until the trigger
        // backend is wired; the shape matches impact_assessments.
        addVillageRow("Japisagiya Gaon", "CRITICAL", "15 min", "critical")
        addVillageRow("Desang Deroi Habi", "CRITICAL", "30 min", "critical")
        addVillageRow("Rajan Bagan", "HIGH", "45 min", "high")

        addLabel("Relay")
        addMetric("Nearby nodes", "${connectedEndpoints.size}")
        addCard(if (relayStarted) "Relay active." else "Relay stopped. Start it below to hop alerts phone to phone.")
    }

    private fun renderDisasterAuthority(session: SessionStore.Session) {
        val data = dashboardSummary
        val evaluation = data?.evaluations?.firstOrNull()

        addRiskBanner(
            riskLevel = evaluation?.riskLevel ?: "normal",
            headline = bandLabel(evaluation?.riskLevel),
            detail = "Regional situation across monitored basins",
        )

        addLabel("Region")
        addMetric("Stations", "${data?.stations?.size ?: 0}")
        addMetric("Active alerts", "${data?.alerts?.size ?: 0}")
        addMetric("Villages at risk", "3")
        addMetric("People at risk", "5,004")

        val pending = emergencyStore.pendingAlerts().firstOrNull()
        val remoteAlert = data?.alerts?.firstOrNull()

        addLabel("Approval queue")
        when {
            remoteAlert != null -> addCard("${remoteAlert.title}\n${remoteAlert.priority} · ${remoteAlert.status}")
            pending != null -> addCard("${pending.title}\n${pending.severity} · ${pending.status}")
            else -> addCard("Approval queue is clear.")
        }
        pending?.let { alert ->
            addPrimaryAction("Approve regional warning") {
                emergencyStore.updateAlertStatus(alert.id, "APPROVED", session.username)
                updateStatus("Regional warning approved")
                renderRoleWorkspace(session)
            }
            addSecondaryAction("Request more information") {
                emergencyStore.updateAlertStatus(alert.id, "INFO_REQUESTED", session.username)
                updateStatus("More information requested")
                renderRoleWorkspace(session)
            }
        }

        addLabel("Communication")
        addCard("Internet and cellular available. Offline mesh ready for failover.")
    }

    private fun renderVillageAuthority(session: SessionStore.Session) {
        val alert = emergencyStore.latestAlert()
        val remoteAlert = dashboardSummary?.alerts?.firstOrNull()

        // Village-level only. Basin-wide station data is the Control Room's job.
        val band = remoteAlert?.priority ?: alert?.severity ?: "NORMAL"
        addRiskBanner(
            riskLevel = band,
            headline = if (remoteAlert == null && alert == null) "No active warning" else "WARNING",
            detail = "Japisagiya Gaon",
        )

        addLabel("Current warning")
        addCard(
            remoteAlert?.let { "${it.title}\n${it.priority} · ${it.status}" }
                ?: alert?.let { "${it.title}\n${it.message}" }
                ?: "There is no active warning for your village right now."
        )

        alert?.let {
            addPrimaryAction("I received this warning") {
                emergencyStore.acknowledge(it.id, session.username)
                updateStatus("Warning acknowledgement saved locally")
            }
        }

        addLabel("What to do")
        addCard("Move toward the designated safe area.\nKeep your phone charged.\nFollow instructions from the village authority.\nDo not return until cleared.")

        addLabel("Local communication")
        addCard("Internet and cellular available. Offline mesh on standby.")

        addSecondaryAction("Report local situation") { showReportDialog(session) }

        addLabel("Reports")
        addMetric("Awaiting sync", "${emergencyStore.reports().count { it.village == "Japisagiya Gaon" }}")
    }

    private fun renderCommunityMember(session: SessionStore.Session) {
        val alert = emergencyStore.latestAlert()
        val remoteAlert = dashboardSummary?.alerts?.firstOrNull()

        // A resident sees no score, no band vocabulary, no station data.
        // Just: is there a warning, what to do, and two actions.
        val headline = if (remoteAlert == null && alert == null) "No warning" else "WARNING"
        val riskLevel = remoteAlert?.priority ?: alert?.severity ?: "normal"
        addRiskBanner(
            riskLevel = riskLevel,
            headline = headline,
            detail = "Japisagiya Gaon",
        )

        addLabel("What you need to do")
        addCard(
            "1. Move to higher ground now.\n" +
            "2. Take your family and go with neighbours.\n" +
            "3. Keep this phone charged and nearby."
        )

        alert?.let {
            addPrimaryAction("I received this warning") {
                emergencyStore.acknowledge(it.id, session.username)
                updateStatus("Thank you. Your village authority has been notified.")
            }
        }
        addSecondaryAction("Report an emergency") { showReportDialog(session) }
    }

    private fun renderSystemAdmin(session: SessionStore.Session) {
        val data = dashboardSummary
        addRiskBanner(
            riskLevel = if (data == null) "warning" else "normal",
            headline = if (data == null) "Not connected" else "Systems healthy",
            detail = this.deviceName(),
        )
        addLabel("Platform")
        addMetric("Stations", "${data?.stations?.size ?: 0}")
        addMetric("Active alerts", "${data?.alerts?.size ?: 0}")
        addMetric("Rule evaluations", "${data?.evaluations?.size ?: 0}")

        addLabel("Device and relay")
        addMetric("Nearby relay", if (relayStarted) "Active" else "Stopped")
        addMetric("Connected nodes", "${connectedEndpoints.size}")
        addMetric("Offline queue", "${emergencyStore.reports().size} report(s)")
        addMetric("Audit events", "${emergencyStore.auditEntries()}")
    }

    // ---------------------------------------------------------------------
    // Light-theme UI helpers.
    //
    // A community member must never see a score; an operator must never read a
    // paragraph to find the risk band. So risk is a colour + one word, and every
    // fact sits in a card instead of a wall of monospace text.
    // ---------------------------------------------------------------------

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun riskTone(riskLevel: String?): Pair<Int, Int> {
        val normalized = (riskLevel ?: "normal").lowercase()
        return when {
            normalized.contains("critical") -> R.color.sx_critical to R.color.sx_critical_soft
            normalized.contains("high") -> R.color.sx_high to R.color.sx_high_soft
            normalized.contains("warning") || normalized.contains("moderate") -> R.color.sx_warning to R.color.sx_warning_soft
            normalized.contains("watch") || normalized.contains("low") -> R.color.sx_watch to R.color.sx_watch_soft
            else -> R.color.sx_normal to R.color.sx_normal_soft
        }
    }

    private fun severityTone(severity: String?): Pair<Int, Int> {
        val normalized = (severity ?: "").lowercase()
        return when {
            normalized.contains("p0") || normalized.contains("critical") -> R.color.sx_critical to R.color.sx_critical_soft
            normalized.contains("p1") || normalized.contains("high") -> R.color.sx_high to R.color.sx_high_soft
            normalized.contains("p2") -> R.color.sx_warning to R.color.sx_warning_soft
            else -> R.color.sx_normal to R.color.sx_normal_soft
        }
    }

    /** Section label: small, uppercase, muted. Sits above a card. */
    private fun addLabel(title: String) {
        roleContent.addView(TextView(this).apply {
            text = title.uppercase()
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_text_faint))
            textSize = 11f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            letterSpacing = 0.1f
            setPadding(dp(2), dp(14), dp(2), dp(6))
        })
    }

    /** A white bordered card holding one body of text. */
    private fun addCard(body: String) {
        roleContent.addView(TextView(this).apply {
            text = body
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_text))
            textSize = 15f
            setLineSpacing(0f, 1.2f)
            setBackgroundResource(R.drawable.sx_card)
            setPadding(dp(16), dp(14), dp(16), dp(14))
        })
    }

    /** A colour-coded card for the single most important fact on a screen. */
    private fun addRiskBanner(riskLevel: String, headline: String, detail: String) {
        val (accent, _) = riskTone(riskLevel)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@MainActivity).apply {
                text = headline
                setTextColor(ContextCompat.getColor(this@MainActivity, accent))
                textSize = 20f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            addView(TextView(this@MainActivity).apply {
                text = detail
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_text_muted))
                textSize = 13f
                setPadding(0, dp(4), 0, 0)
            })
        }
        roleContent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundResource(R.drawable.sx_card)
            addView(View(this@MainActivity).apply {
                setBackgroundColor(ContextCompat.getColor(this@MainActivity, accent))
            }, LinearLayout.LayoutParams(dp(6), LinearLayout.LayoutParams.MATCH_PARENT).apply {
                setMargins(dp(16), dp(14), dp(12), dp(14))
            })
            addView(body, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(0, dp(14), dp(16), dp(14))
            })
        })
    }

    /** Compact label/value row so a number never needs a sentence around it. */
    private fun addMetric(label: String, value: String) {
        roleContent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundResource(R.drawable.sx_card)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            addView(TextView(this@MainActivity).apply {
                text = label
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_text_muted))

                textSize = 14f
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@MainActivity).apply {
                text = value
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_text))
                textSize = 14f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
        })
    }

    /** One-line village summary: name on the left, band + ETA on the right. */
    private fun addVillageRow(name: String, band: String, eta: String, riskLevel: String) {
        val (accent, _) = riskTone(riskLevel)
        roleContent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.sx_card)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            addView(View(this@MainActivity).apply {
                setBackgroundColor(ContextCompat.getColor(this@MainActivity, accent))
            }, LinearLayout.LayoutParams(dp(4), dp(28)).apply { setMargins(0, 0, dp(12), 0) })
            addView(TextView(this@MainActivity).apply {
                text = name
                setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_text))
                textSize = 15f
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@MainActivity).apply {
                text = "$band  ·  $eta"
                setTextColor(ContextCompat.getColor(this@MainActivity, accent))
                textSize = 13f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
        })
    }

    private fun addPrimaryAction(label: String, action: () -> Unit) {
        roleContent.addView(Button(this).apply {
            text = label
            isAllCaps = false
            setBackgroundResource(R.drawable.sx_button_primary)
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_surface))
            setOnClickListener { action() }
        }.apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
        })
    }

    private fun addSecondaryAction(label: String, action: () -> Unit) {
        roleContent.addView(Button(this).apply {
            text = label
            isAllCaps = false
            setBackgroundResource(R.drawable.sx_button_secondary)
            setTextColor(ContextCompat.getColor(this@MainActivity, R.color.sx_brand))
            setOnClickListener { action() }
        }.apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(8)
            }
        })
    }

    /** Human-readable band label. Residents never see a raw score. */
    private fun bandLabel(riskLevel: String?): String = (riskLevel ?: "UNKNOWN").uppercase()

    private fun showReportDialog(session: SessionStore.Session) {
        val input = EditText(this).apply { hint = "Describe what is happening"; minLines = 3 }
        val types = arrayOf("Water rising", "Flooding observed", "Road blocked", "Evacuation issue", "Other emergency")
        val choices = types.map { type -> RadioButton(this).apply { text = type } }
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 8, 32, 0) }
        choices.forEach { box.addView(it) }; box.addView(input)
        AlertDialog.Builder(this).setTitle("Report local situation").setView(box).setNegativeButton("Cancel", null).setPositiveButton("Save report") { _, _ ->
            val type = choices.firstOrNull { it.isChecked }?.text?.toString() ?: "Other emergency"
            emergencyStore.addReport(type, input.text.toString().ifBlank { "No description provided" }, "Japisagiya Gaon", session.username)
            updateStatus("Report saved locally and queued for sync")
            renderRoleWorkspace(session)
        }.show()
    }

    private fun requestPermissionsAndStart() {
        val permissions = requiredPermissions()
        val missing = permissions.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            updateStatus("Allow Nearby devices permission to start the relay")
            requestPermissions(missing.toTypedArray(), 100)
        } else {
            startRelay()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode != 100) return
        if (results.isNotEmpty() && results.all { it == PackageManager.PERMISSION_GRANTED }) {
            startRelay()
        } else {
            updateStatus("Nearby permission denied. Enable it in App settings and retry")
        }
    }

    private fun startRelay() {
        if (relayStarted) {
            updateStatus("Relay already active / waiting for nearby phones")
            return
        }
        try {
            val advertising = AdvertisingOptions.Builder().setStrategy(strategy).build()
            val discovery = DiscoveryOptions.Builder().setStrategy(strategy).build()
            connections.stopAdvertising()
            connections.stopDiscovery()
            updateStatus("Starting Nearby relay...")
            connections.startAdvertising(deviceName(), serviceId, lifecycleCallback, advertising)
                .addOnSuccessListener {
                    relayStarted = true
                    updateStatus("Relay active / advertising as ${deviceName()}")
                }
                .addOnFailureListener { error ->
                    relayStarted = false
                    updateStatus("Advertising unavailable: ${nearbyError(error)}")
                }
            connections.startDiscovery(serviceId, discoveryCallback, discovery)
                .addOnSuccessListener {
                    relayStarted = true
                    updateStatus("Relay active / looking for nearby phones")
                }
                .addOnFailureListener { error ->
                    val message = error.message.orEmpty()
                    if (message.contains("already", ignoreCase = true) || message.contains("discover", ignoreCase = true)) {
                        relayStarted = true
                        updateStatus("Relay active / already discovering nearby phones")
                    } else {
                        updateStatus("Discovery unavailable: ${nearbyError(error)}")
                    }
                }
        } catch (error: SecurityException) {
            relayStarted = false
            updateStatus("Nearby permission missing. Enable Nearby devices and retry")
        }
    }

    private fun sendDemoAlert() {
        if (!relayStarted) startRelay()
        val id = UUID.randomUUID().toString()
        val message = "$id|P0|FLASH FLOOD|Bhairavpur|14 minutes to impact. Move to higher ground.|$defaultChainHops|${deviceName()}"
        receiveAndRelay(message, null)
    }

    private fun receiveAndRelay(message: String, fromEndpointId: String?) {
        val parts = message.split('|', limit = 8)
        if (parts.size < 5 || !receivedAlertIds.add(parts[0])) return
        val remainingHops = parts.getOrNull(5)?.toIntOrNull() ?: 0
        val visitedNames = parts.getOrNull(6).orEmpty().split(',').filter { it.isNotBlank() }.toSet()
        emergencyStore.addAlert(parts[0], parts[1], parts[2], parts[3], parts[4])
        runOnUiThread {
            alertsText.text = "${parts[1]} / ${parts[2]}\n${parts[3]}\n${parts[4]}\nChain hops remaining: $remainingHops"
            showAlertNotification(parts[2], "${parts[3]}: ${parts[4]}")
        }
        forwardToNextHop(parts, remainingHops, fromEndpointId, visitedNames)
    }

    private fun forwardToNextHop(parts: List<String>, remainingHops: Int, fromEndpointId: String?, visitedNames: Set<String>) {
        if (remainingHops <= 0) {
            updateStatus("Alert delivered / chain complete")
            return
        }
        val nextEndpoint = connectedEndpoints
            .filter { it != fromEndpointId }
            .filter { endpointNames[it].orEmpty() !in visitedNames }
            .sorted()
            .firstOrNull()
        if (nextEndpoint == null) {
            updateStatus("Alert stored / waiting for the next relay node")
            return
        }
        val nextName = endpointNames[nextEndpoint].orEmpty().ifBlank { "node-${nextEndpoint.take(6)}" }
        val forwardedMessage = parts.take(5).joinToString("|") + "|${remainingHops - 1}|${(visitedNames + nextName).joinToString(",")}"
        connections.sendPayload(nextEndpoint, Payload.fromBytes(forwardedMessage.toByteArray(StandardCharsets.UTF_8)))
        updateStatus("Alert forwarded one hop / ${remainingHops - 1} remaining")
    }

    private fun showAlertNotification(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val notification = NotificationCompat.Builder(this, notificationChannel)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("P0 flood warning / $title")
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(this).notify(1001, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(notificationChannel, "Emergency alerts", NotificationManager.IMPORTANCE_HIGH)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    // POST_NOTIFICATIONS must be requested explicitly on Android 13+.
    // showAlertNotification() returns early without it, so a received alert
    // would be accepted and forwarded but never actually appear on the phone.
    // The previous variant of this app omitted it here, which is why relayed
    // alerts could arrive silently.
    private fun requiredPermissions(): Array<String> = if (Build.VERSION.SDK_INT >= 33) {
        arrayOf(
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.NEARBY_WIFI_DEVICES,
            Manifest.permission.POST_NOTIFICATIONS
        )
    } else if (Build.VERSION.SDK_INT >= 31) {
        arrayOf(
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.POST_NOTIFICATIONS
        )
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    private fun deviceName(): String = "LastMile-${Build.MODEL.take(12)}"

    private fun nearbyError(error: Exception): String = error.message
        ?.takeIf { it.isNotBlank() }
        ?: "turn on Bluetooth and Nearby devices permissions"

    private fun updateStatus(message: String) = runOnUiThread { statusText.text = message }
}
