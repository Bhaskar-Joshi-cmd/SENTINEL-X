import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, MapPin, RefreshCw, ShieldCheck, Waves, XCircle } from 'lucide-react'
import {
  fieldVerifyCommunityReport,
  getVillages,
  getVillageAuthoritySummary,
  type CommunityReport,
  type Village,
  type VillageAuthoritySummary,
} from './api'

type RiverCode = 'TEESTA' | 'DESANG'

type Props = {
  riverCode: RiverCode
}

const CLOSED_STATUSES = ['rejected', 'not_confirmed', 'field_confirmed']

function statusLabel(value: string | null | undefined) {
  const normalized = (value ?? 'submitted').toLowerCase()
  if (normalized === 'pending') return 'SUBMITTED'
  if (normalized === 'submitted') return 'SUBMITTED'
  if (normalized === 'field_confirmed') return 'FIELD CONFIRMED'
  if (normalized === 'not_confirmed') return 'NOT CONFIRMED'
  if (normalized === 'corroborated') return 'CORROBORATED'
  if (normalized === 'verified') return 'VERIFIED (CONTROL ROOM)'
  if (normalized === 'rejected') return 'REJECTED'
  return normalized.replaceAll('_', ' ').toUpperCase()
}

function statusTone(value: string | null | undefined) {
  const normalized = (value ?? 'submitted').toLowerCase()
  if (normalized === 'field_confirmed' || normalized === 'corroborated' || normalized === 'verified') return 'positive'
  if (normalized === 'rejected' || normalized === 'not_confirmed') return 'critical'
  return 'watch'
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export default function CommunityManagerPage({ riverCode }: Props) {
  const [villages, setVillages] = useState<Village[]>([])
  const [villageId, setVillageId] = useState('')
  const [summary, setSummary] = useState<VillageAuthoritySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [comments, setComments] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void getVillages(riverCode)
      .then((response) => {
        if (cancelled) return
        const items = response.items ?? []
        setVillages(items)
        setVillageId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id ?? ''))
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load villages')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [riverCode])

  const loadSummary = useCallback(() => {
    if (!villageId) return
    void getVillageAuthoritySummary(villageId)
      .then((data) => setSummary(data))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load village summary'))
  }, [villageId])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const village = useMemo(
    () => villages.find((item) => item.id === villageId) ?? summary?.village ?? null,
    [villages, villageId, summary],
  )
  const reports = useMemo(
    () => [...(summary?.reports ?? [])].sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()),
    [summary],
  )

  const station = summary?.station ?? null
  const reading = summary?.latest_reading ?? null
  const evaluation = summary?.latest_evaluation ?? null
  const openReports = reports.filter((item) => !CLOSED_STATUSES.includes((item.verification_status ?? '').toLowerCase()))
  const confirmedCount = reports.filter((item) => (item.verification_status ?? '').toLowerCase() === 'field_confirmed').length

  async function handleFieldDecision(report: CommunityReport, decision: 'confirmed' | 'disputed') {
    setBusyId(report.id)
    setNote('')
    setError('')
    try {
      await fieldVerifyCommunityReport(report.id, {
        decision,
        comments: comments.trim() ? comments.trim() : undefined,
      })
      setComments('')
      setNote(
        decision === 'confirmed'
          ? 'Field confirmation recorded. The next engine tick counts it as +2 community evidence.'
          : 'Dispute recorded. This report no longer contributes positive community evidence.',
      )
      loadSummary()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to record the field decision')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="cm-page">
      <section className="panel va-heading">
        <div>
          <span className="section-kicker">COMMUNITY MANAGER / FIELD VERIFICATION</span>
          <h1>Ground-truth verification desk</h1>
          <p>Designated trained local field POC. Confirm what neighbours reported only if you can physically see it — your confirmation is independent field evidence, not an official alert.</p>
        </div>
        <div className="va-demo-identity">
          <span>ASSIGNED VILLAGE</span>
          <b>{village?.village_name ?? 'Select a village'}</b>
          <small>{riverCode === 'TEESTA' ? 'Teesta / Melli basin' : 'Desang / Nanglamoraghat basin'}</small>
        </div>
      </section>

      {error && <div className="panel va-error">{error}</div>}

      <div className="cm-grid">
        <section className="panel cm-card">
          <span className="section-kicker">LOCAL IDENTITY</span>
          <h2>Assigned village</h2>
          <label className="cm-field">
            <span>Village</span>
            <select value={villageId} onChange={(event) => setVillageId(event.target.value)} disabled={!villages.length}>
              {!villages.length && <option value="">Loading villages…</option>}
              {villages.map((item) => (
                <option key={item.id} value={item.id}>{item.village_name}</option>
              ))}
            </select>
          </label>
          <div className="va-context-grid">
            <div><span>District</span><b>{village?.district ?? '—'}</b></div>
            <div><span>Population</span><b>{formatNumber(village?.population)}</b></div>
          </div>
          <div className="cm-report-actions">
            <button className="cm-btn" onClick={loadSummary}><RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh</button>
          </div>
        </section>

        <section className="panel cm-card">
          <span className="section-kicker">LOCAL HAZARD STATUS</span>
          <h2>{station?.station_name ?? 'No station linked to this village'}</h2>
          <div className="va-context-grid">
            <div><span>Water level</span><b>{reading?.water_level_m != null ? `${Number(reading.water_level_m).toFixed(2)} m` : '—'}</b></div>
            <div><span>Rise rate</span><b>{reading?.water_level_rate_m_hr != null ? `${Number(reading.water_level_rate_m_hr).toFixed(2)} m/hr` : '—'}</b></div>
            <div><span>Warning</span><b>{station?.warning_level_m != null ? `${Number(station.warning_level_m).toFixed(2)} m` : '—'}</b></div>
            <div><span>Danger</span><b>{station?.danger_level_m != null ? `${Number(station.danger_level_m).toFixed(2)} m` : '—'}</b></div>
          </div>
          <div className="va-report-main">
            <span className={'risk-summary ' + String(evaluation?.risk_level ?? 'watch').toLowerCase()}>{evaluation?.risk_level?.toUpperCase() ?? 'MONITORING'}</span>
            <p className="va-rule-note">Engine score {evaluation?.total_score != null ? `${evaluation.total_score}/100` : '—'} · observed {formatTime(reading?.observed_at)}</p>
          </div>
        </section>

        <section className="panel cm-card">
          <span className="section-kicker">EVIDENCE LADDER</span>
          <h2>What your confirmation is worth</h2>
          <div className="cm-ladder">
            <div><span>First village report</span><b>+1</b></div>
            <div><span>Second independent reporter</span><b>+1</b></div>
            <div><span>Field confirmation by you</span><b>+2 ({confirmedCount} recorded)</b></div>
            <div><span>Village Authority corroboration</span><b>+1</b></div>
            <div><span>Maximum community evidence</span><b>5 / 5</b></div>
          </div>
          <p className="va-rule-note">{openReports.length} of {reports.length} village reports still await your field decision. Evidence is re-scored on the next 10 s engine tick.</p>
        </section>
      </div>

      <section className="panel va-reports-card">
        <div className="panel-head compact">
          <div><span className="section-kicker">VILLAGE REPORTS</span><h2>Confirm or dispute from the ground</h2></div>
          <span className="status-badge pending">{openReports.length} AWAITING</span>
        </div>

        <label className="cm-field">
          <span>Field comments (attached to your decision)</span>
          <input value={comments} onChange={(event) => setComments(event.target.value)} placeholder="e.g. Water is over the culvert, knee-deep on the school road…" />
        </label>

        {note && <div className="cm-note"><ShieldCheck size={14} /><span>{note}</span></div>}

        {!reports.length ? (
          <div className="va-empty"><MapPin size={16} /> <span>{loading ? 'Loading village reports…' : 'No community report has been submitted for this village yet.'}</span></div>
        ) : (
          <div className="va-report-list">
            {reports.map((report) => {
              const status = (report.verification_status ?? '').toLowerCase()
              const closed = CLOSED_STATUSES.includes(status)
              return (
                <div className="va-report-row" key={report.id}>
                  <div className="va-report-main">
                    <div>
                      <b>{report.report_type.replaceAll('_', ' ')}</b>
                      <span className={'risk-summary ' + statusTone(report.verification_status)}>{statusLabel(report.verification_status)}</span>
                      <span className="va-source-chip">{report.severity}</span>
                    </div>
                    <p>{report.description ?? 'No description supplied with this report.'}</p>
                    <p>{formatTime(report.submitted_at)} · {report.reporter_user_id ? `reporter ${String(report.reporter_user_id).slice(0, 8)}…` : 'anonymous local reporter'} · trust score {report.trust_score ?? '—'}</p>
                  </div>
                  <div className="va-report-meta">
                    {closed ? (
                      <>
                        <b>Closed</b>
                        <span>{status === 'field_confirmed' ? 'Confirmed on site by you' : status === 'not_confirmed' ? 'Disputed by field POC' : 'Closed after review'}</span>
                      </>
                    ) : (
                      <div className="cm-report-actions">
                        <button className="cm-btn confirm" disabled={busyId === report.id} onClick={() => void handleFieldDecision(report, 'confirmed')}>
                          <CheckCircle2 size={13} /> {busyId === report.id ? 'Saving…' : 'Confirm on site'}
                        </button>
                        <button className="cm-btn dispute" disabled={busyId === report.id} onClick={() => void handleFieldDecision(report, 'disputed')}>
                          <XCircle size={13} /> Dispute
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="va-connectivity-note">
          <Waves size={14} />
          <span>
            {summary?.deliveries?.length ? `${summary.deliveries.length} last-mile delivery record(s) tracked for this village.` : 'No last-mile delivery record for this village yet.'}
            {' '}<Clock3 size={12} />{' '}
            Community reports never raise an official alert — the Control Room reviews them and the Disaster Authority approves public warnings.
          </span>
        </div>
      </section>
    </div>
  )
}

