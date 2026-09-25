package com.lastmile.alert

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class EmergencyStore(context: Context) : SQLiteOpenHelper(context, "lastmile_emergency.db", null, 1) {
    data class Alert(val id: String, val severity: String, val title: String, val village: String, val message: String, val status: String)
    data class Report(val type: String, val village: String, val status: String, val createdAt: Long)

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE alerts (id TEXT PRIMARY KEY, severity TEXT NOT NULL, title TEXT NOT NULL, village TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, approved_by TEXT)")
        db.execSQL("CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, description TEXT NOT NULL, village TEXT NOT NULL, reported_by TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE acknowledgements (alert_id TEXT NOT NULL, username TEXT NOT NULL, acknowledged_at INTEGER NOT NULL, PRIMARY KEY(alert_id, username))")
        db.execSQL("CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at INTEGER NOT NULL)")
        // No sample alert is seeded any more. A fabricated "Desang flood warning"
        // made the alert queue look populated before any real data existed, which
        // is misleading during a demo. Rows appear only when a real relayed or
        // backend alert is received.
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun addAlert(id: String, severity: String, title: String, village: String, message: String, status: String = "PENDING") {
        addAlert(writableDatabase, id, severity, title, village, message, status)
    }

    fun pendingAlerts(): List<Alert> = readableDatabase.query("alerts", null, "status = ?", arrayOf("PENDING"), null, null, "created_at DESC").use { cursor ->
        buildList { while (cursor.moveToNext()) add(readAlert(cursor)) }
    }

    fun latestAlert(): Alert? = readableDatabase.query("alerts", null, null, null, null, null, "created_at DESC", "1").use { cursor ->
        if (cursor.moveToFirst()) readAlert(cursor) else null
    }

    fun updateAlertStatus(id: String, status: String, username: String) {
        writableDatabase.update("alerts", ContentValues().apply { put("status", status); put("approved_by", username) }, "id = ?", arrayOf(id))
        audit(username, "ALERT_$status", id)
    }

    fun acknowledge(alertId: String, username: String) {
        writableDatabase.insertWithOnConflict("acknowledgements", null, ContentValues().apply {
            put("alert_id", alertId); put("username", username); put("acknowledged_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
        audit(username, "ALERT_ACKNOWLEDGED", alertId)
    }

    fun addReport(type: String, description: String, village: String, username: String) {
        writableDatabase.insert("reports", null, ContentValues().apply {
            put("type", type); put("description", description); put("village", village); put("reported_by", username); put("status", "OPEN"); put("created_at", System.currentTimeMillis())
        })
        audit(username, "REPORT_SUBMITTED", type)
    }

    fun reports(): List<Report> = readableDatabase.query("reports", arrayOf("type", "village", "status", "created_at"), null, null, null, null, "created_at DESC").use { cursor ->
        buildList {
            while (cursor.moveToNext()) add(Report(cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getLong(3)))
        }
    }

    fun auditEntries(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM audit_logs", null).use { cursor ->
        if (cursor.moveToFirst()) cursor.getInt(0) else 0
    }

    private fun audit(username: String, action: String, entityId: String) {
        writableDatabase.insert("audit_logs", null, ContentValues().apply {
            put("username", username); put("action", action); put("entity_id", entityId); put("created_at", System.currentTimeMillis())
        })
    }

    private fun addAlert(db: SQLiteDatabase, id: String, severity: String, title: String, village: String, message: String, status: String) {
        db.insertWithOnConflict("alerts", null, ContentValues().apply {
            put("id", id); put("severity", severity); put("title", title); put("village", village); put("message", message); put("status", status); put("created_at", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_IGNORE)
    }

    private fun readAlert(cursor: android.database.Cursor): Alert = Alert(
        cursor.getString(cursor.getColumnIndexOrThrow("id")),
        cursor.getString(cursor.getColumnIndexOrThrow("severity")),
        cursor.getString(cursor.getColumnIndexOrThrow("title")),
        cursor.getString(cursor.getColumnIndexOrThrow("village")),
        cursor.getString(cursor.getColumnIndexOrThrow("message")),
        cursor.getString(cursor.getColumnIndexOrThrow("status"))
    )
}
