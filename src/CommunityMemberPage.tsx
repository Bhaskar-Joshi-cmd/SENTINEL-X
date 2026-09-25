import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CloudOff,
  MapPin,
  RefreshCw,
  Send,
  Smartphone,
  TowerControl,
  Wifi,
} from 'lucide-react'
import {
  acknowledgeDemoWarning,
  getCommunityMemberSummary,
  getCommunityReportOptions,
  getVillages,
  submitDemoCommunityReport,
  type CommunityMemberSummary,
  type CommunityReportOptions,
  type Village,
} from './api'

type Props = {
  riverCode: 'TEESTA' | 'DESANG'
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', hour12: false })
}

function formatEta(value: number | null | undefined) {
  return typeof value === 'number' ? `${Math.round(value)} min` : '—'
}

function titleCase(value: string | null | undefined) {
  if (!value) return '—'
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function priorityTone(priority: string | null | undefined) {
  return priority === 'P0' ? 'critical' : priority === 'P1' ? 'warning' : 'watch'
}

export default function CommunityMemberPage({ riverCode }: Props) {
  const [villages, setVillages] = useState<Village[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState('')
  const [summary, setSummary] = useState<CommunityMemberSummary | null>(null)
  const [options, setOptions] = useState<CommunityReportOptions | null>(null)
  const [loadingVillages, setLoadingVillages] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [ackBusy, setAckBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitState, setSubmitState] = useState('')
  const [ackState, setAckState] = useState('')
  const [reportType, setReportType] = useState('water_rise')
  const [severity, setSeverity] = useState('moderate')
  const [description, setDescription] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadingVillages(true)
    setError('')

    Promise.all([getVillages('TEESTA'), getVillages('DESANG')])
      .then(([teesta, desang]) => {
        if (cancelled) return
        const merged = [...teesta.items, ...desang.items]
        const deduped = Array.from(new Map(merged.map((village) => [village.id, village])).values())
        deduped.sort((a, b) => a.village_name.localeCompare(b.village_name))
        setVillages(deduped)
        const preferredItems = riverCode === 'TEESTA' ? teesta.items : desang.items
        setSelectedVillageId(preferredItems[0]?.id ?? deduped[0]?.id ?? '')
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load village list')
      })
      .finally(() => {
        if (!cancelled) setLoadingVillages(false)
      })

    return () => { cancelled = true }
  }, [riverCode])

  useEffect(() => {
    let cancelled = false
    setLoadingOptions(true)
    getCommunityReportOptions()
      .then((next) => {
        if (cancelled) return
        setOptions(next)
        const defaultType = next.report_types.find((item) => item.value === 'water_rise')?.value ?? next.report_types[0]?.value
        const defaultSeverity = next.severity_levels.find((item) => item.value === 'moderate')?.value ?? next.severity_levels[0]?.value
        if (defaultType) setReportType(defaultType)
        if (defaultSeverity) setSeverity(defaultSeverity)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load reporting options')
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false)
      })
    return () => { cancelled = true }
  }, [])

  async function loadSummary(villageId: string) {
    if (!villageId) return
    setLoadingSummary(true)
    setError('')
    try {
      const response = await getCommunityMemberSummary(villageId)
      setSummary(response)
      setAcknowledged(Boolean(response.latest_delivery?.acknowledged_at))
      setAckState(
        response.latest_delivery?.acknowledged_at
          ? `Acknowledged at ${formatDateTime(response.latest_delivery.acknowledged_at)}.`
          : '',
      )
      setSubmitState('')
    } catch (loadError) {
      setSummary(null)
      setError(loadError instanceof Error ? loadError.message : 'Unable to load community information')
    } finally {
      setLoadingSummary(false)
    }
  }

  useEffect(() => {
    void loadSummary(selectedVillageId)
  }, [selectedVillageId])

  const selectedVillage = useMemo(
    () => villages.find((village) => village.id === selectedVillageId) ?? null,
    [selectedVillageId, villages],
  )

  const publicAlert = useMemo(() => {
    const alert = summary?.current_alert
    if (!alert) return null
    return ['approved', 'dispatching', 'active'].includes(String(alert.status).toLowerCase()) ? alert : null
  }, [summary])

  const delivery = summary?.latest_delivery ?? null
  const impact = summary?.impact ?? null
  const priority = publicAlert?.priority ?? null
  const hasWarning = Boolean(publicAlert)

  async function submitReport() {
    if (!summary?.village.id || !summary.station?.id || !reportType || !severity) return
    setSubmitting(true)
    setSubmitState('')
    setError('')
    try {
      const response = await submitDemoCommunityReport({
        village_id: summary.village.id,
        station_id: summary.station.id,
        report_type: reportType,
        severity,
        description: description.trim() || undefined,
        latitude: summary.village.latitude,
        longitude: summary.village.longitude,
      })
      setDescription('')
      setSubmitState(`Report ${response.report.report_code ?? response.report.id.slice(0, 8)} was submitted for ${summary.village.village_name}.`)
      await loadSummary(summary.village.id)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  async function acknowledgeWarning() {
    if (!summary?.village.id || !hasWarning || acknowledged) return
    setAckBusy(true)
    setError('')
    try {
      const response = await acknowledgeDemoWarning({
        village_id: summary.village.id,
        alert_id: publicAlert?.id ?? null,
      })
      setAcknowledged(true)
      setAckState(`Acknowledged at ${formatDateTime(response.acknowledged_at)}. Stored as a backend delivery record.`)
      await loadSummary(summary.village.id)
    } catch (ackError) {
      setError(ackError instanceof Error ? ackError.message : 'Unable to acknowledge warning')
    } finally {
      setAckBusy(false)
    }
  }

  return (
    <div className="community-member-page">
      <section className="cm-heading panel">
        <div>
          <span className="section-kicker">COMMUNITY MEMBER / SENTINEL-X</span>
          <h1>Warnings for your village, not the whole region.</h1>
          <p>
            This view intentionally exposes only information relevant to one village. In the authenticated version,
            the selected village will come from the signed-in community member&apos;s <code>user_profiles.village_id</code>.
          </p>
        </div>
        <div className="cm-demo-identity">
          <span>DEMO IDENTITY</span>
          <strong>Community Member</strong>
          <small>{summary?.basin?.basin_name ?? 'Select your village'}</small>
        </div>
      </section>

      <section className="panel cm-selector-card">
        <div>
          <span className="section-kicker">LOCAL IDENTITY / DEMO</span>
          <h2>Which village are you in?</h2>
          <p>For now, this selector stands in for the future authenticated village assignment.</p>
        </div>
        <label className="cm-select-wrap">
          <span>Village</span>
          <div className="cm-select-control">
            <MapPin size={16} />
            <select value={selectedVillageId} disabled={loadingVillages} onChange={(event) => setSelectedVillageId(event.target.value)}>
              {loadingVillages ? <option value="">Loading villages…</option> : null}
              {villages.map((village) => <option key={village.id} value={village.id}>{village.village_name}</option>)}
            </select>
            <ChevronDown size={15} />
          </div>
        </label>
      </section>

      {error ? <div className="panel cm-error"><AlertTriangle size={16} /><span>{error}</span></div> : null}

      {loadingSummary ? (
        <div className="panel cm-loading"><RefreshCw size={17} className="spin" /> Loading your local emergency information…</div>
      ) : summary ? (
        <>
          <section className={'panel cm-warning-card ' + (hasWarning ? priorityTone(priority) : 'normal')}>
            <div className="cm-warning-top">
              <div>
                <span className="section-kicker">LOCAL WARNING</span>
                <div className="cm-source-line">
                  <MapPin size={14} /> {summary.village.village_name} · {summary.village.district ?? 'District unavailable'}
                </div>
              </div>
              <span className={'cm-received-chip ' + (hasWarning ? 'on' : '')}><Smartphone size={13} /> {delivery?.channel ? titleCase(delivery.channel) : 'Monitoring'}</span>
            </div>

            {hasWarning ? (
              <>
                <span className="cm-warning-label">{priority ?? 'WARNING'} · {publicAlert?.severity?.toUpperCase() ?? 'PUBLIC WARNING'}</span>
                <h2>{publicAlert?.title ?? 'Emergency warning'}</h2>
                {impact?.time_to_impact_minutes != null ? (
                  <div className="cm-eta"><span>ESTIMATED LOCAL IMPACT</span><strong>{formatEta(impact.time_to_impact_minutes)}</strong></div>
                ) : null}
                <p className="cm-warning-copy">{publicAlert?.description ?? 'Follow official local instructions.'}</p>
                <div className="cm-action-box"><AlertTriangle size={19} /><div><b>WHAT TO DO</b><span>{publicAlert?.instruction ?? 'Move toward the designated safe area if directed. Avoid rivers, bridges and low-lying roads.'}</span></div></div>
                <small className="cm-last-update">Last warning update: {formatDateTime(publicAlert?.created_at)}</small>
              </>
            ) : (
              <>
                <span className="cm-safe-label">NO ACTIVE PUBLIC WARNING</span>
                <h2>You are currently on monitoring status.</h2>
                <p className="cm-warning-copy">No approved public warning is currently assigned to this village. Keep notifications enabled and continue following official local guidance.</p>
              </>
            )}
          </section>

          <div className="cm-grid">
            <section className="panel cm-response-card">
              <div className="panel-head compact"><div><span className="section-kicker">01 / YOUR RESPONSE</span><h2>Warning received?</h2></div></div>
              <p>{hasWarning ? 'Acknowledge the warning so a persisted delivery record is stored against this village.' : 'There is no active public warning to acknowledge right now.'}</p>
              <button className={'cm-ack-btn ' + (acknowledged ? 'done' : '')} disabled={!hasWarning || acknowledged || ackBusy} onClick={() => void acknowledgeWarning()}>
                {acknowledged ? <><CheckCircle2 size={17} /> {ackState || 'Warning acknowledged'}</> : ackBusy ? <><RefreshCw size={17} className="spin" /> Saving…</> : <><Bell size={17} /> I received this warning</>}
              </button>
              {!acknowledged && ackState ? <div className="cm-success"><CheckCircle2 size={16} /><span>{ackState}</span></div> : null}
              <div className="cm-response-note"><ShieldIcon /><span>Acknowledgement is persisted as an <code>alert_deliveries</code> record for this village. Auth will later bind it to the signed-in member.</span></div>
            </section>

            <section className="panel cm-condition-card">
              <div className="panel-head compact"><div><span className="section-kicker">02 / LOCAL WARNING CONTEXT</span><h2>What applies to your village</h2></div></div>
              <div className="cm-condition-grid">
                <div><span>Village impact</span><b>{impact ? `${Math.round(impact.risk_score)} · ${titleCase(impact.risk_level)}` : 'Not assessed'}</b></div>
                <div><span>Time to impact</span><b>{formatEta(impact?.time_to_impact_minutes)}</b></div>
                <div><span>Alert</span><b>{publicAlert ? `${publicAlert.priority ?? 'P3'} · ${titleCase(publicAlert.status)}` : 'Monitoring'}</b></div>
                <div><span>Station</span><b>{summary.station?.station_name ?? '—'}</b></div>
              </div>
              <div className="cm-offline-note"><CloudOff size={15} /><span>Full telemetry and engine evidence stay in the Control Room view. This card shows only what your village must act on.</span></div>
            </section>
          </div>

          <section className="panel cm-connectivity-card">
            <div className="panel-head compact"><div><span className="section-kicker">03 / YOUR REACHABILITY</span><h2>How you will be reached</h2></div></div>
            <div className="cm-channel-grid">
              <div className={delivery ? 'active' : ''}><Smartphone size={17} /><b>Last delivery</b><span>{delivery ? `${titleCase(delivery.channel)} · ${titleCase(delivery.delivery_status)}` : 'No record yet'}</span></div>
              <div className={summary.village.internet_available ? 'active' : ''}><Wifi size={17} /><b>Internet</b><span>{summary.village.internet_available ? 'Available' : 'Offline'}</span></div>
              <div className={summary.village.cellular_available ? 'active' : ''}><TowerControl size={17} /><b>Cellular</b><span>{summary.village.cellular_available ? 'Available' : 'Offline'}</span></div>
            </div>
            <div className="cm-offline-note"><CloudOff size={15} /><span>Village delivery operations stay in the Control Room workspace. Reachability above comes from stored village delivery records.</span></div>
          </section>

          <section className="panel cm-report-card">
            <div className="panel-head compact"><div><span className="section-kicker">04 / REPORT LOCAL CONDITIONS</span><h2>Tell the system what you see</h2></div><span className="cm-schema-chip">COMMUNITY_REPORTS</span></div>
            <p className="cm-report-intro">Your report is stored against <code>{summary.village.village_name}</code> and its monitoring station. It uses the same community-report data path as the rest of Sentinel-X.</p>
            <div className="cm-report-form">
              <label><span>What are you seeing?</span><select value={reportType} onChange={(event) => setReportType(event.target.value)} disabled={loadingOptions || submitting}>{options?.report_types.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={loadingOptions || submitting}>{options?.severity_levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="full"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe what is happening near you…" rows={4} disabled={submitting} /></label>
            </div>
            <button className="cm-submit-btn" disabled={submitting || !summary.station?.id || !reportType || !severity} onClick={() => void submitReport()}>
              {submitting ? <><RefreshCw size={16} className="spin" /> Sending report…</> : <><Send size={16} /> Submit situation report</>}
            </button>
            {submitState ? <div className="cm-success"><CheckCircle2 size={16} /><span>{submitState}</span></div> : null}
            <div className="cm-report-boundary"><ClipboardList size={15} /><span>The report is submitted with the current demo village identity. Later, the backend will derive that village from the authenticated community member instead of trusting a selector.</span></div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function ShieldIcon() {
  return <span className="cm-note-icon"><CheckCircle2 size={14} /></span>
}
