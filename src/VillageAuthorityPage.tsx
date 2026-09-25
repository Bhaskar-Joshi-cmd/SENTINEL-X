import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CloudOff,
  Gauge,
  MapPin,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  TowerControl,
  Users,
  Wifi,
} from 'lucide-react'
import {
  getCommunityReportOptions,
  getVillageAuthoritySummary,
  getVillages,
  submitDemoVillageReport,
  type CommunityReportOption,
  type CommunityReportOptions,
  type Village,
  type VillageAuthoritySummary,
} from './api'

type Props = {
  riverCode: 'TEESTA' | 'DESANG'
}

type Risk = 'normal' | 'watch' | 'warning' | 'high' | 'critical'

function riskClass(value: string | null | undefined): Risk {
  const risk = String(value ?? 'normal').toLowerCase()
  if (risk === 'critical' || risk === 'high' || risk === 'warning' || risk === 'watch') return risk
  return 'normal'
}

function riskLabel(value: string | null | undefined) {
  return riskClass(value).toUpperCase()
}

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('en-IN') : '—'
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

function deliveryClass(value: string | null | undefined) {
  const status = String(value ?? '').toLowerCase()
  if (status === 'delivered' || status === 'acknowledged') return 'delivered'
  if (status === 'failed') return 'failed'
  return 'pending'
}

export default function VillageAuthorityPage({ riverCode }: Props) {
  const [villages, setVillages] = useState<Village[]>([])
  const [selectedVillageId, setSelectedVillageId] = useState('')
  const [summary, setSummary] = useState<VillageAuthoritySummary | null>(null)
  const [reportOptions, setReportOptions] = useState<CommunityReportOptions | null>(null)
  const [loadingVillages, setLoadingVillages] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submitState, setSubmitState] = useState('')
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
        const preferred = (riverCode === 'TEESTA' ? teesta.items : desang.items)[0]?.id ?? deduped[0]?.id ?? ''
        setSelectedVillageId(preferred)
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
      .then((options) => {
        if (cancelled) return
        setReportOptions(options)
        const defaultType = options.report_types.find((item) => item.value === 'water_rise')?.value ?? options.report_types[0]?.value
        const defaultSeverity = options.severity_levels.find((item) => item.value === 'moderate')?.value ?? options.severity_levels[0]?.value
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
      const next = await getVillageAuthoritySummary(villageId)
      setSummary(next)
    } catch (loadError) {
      setSummary(null)
      setError(loadError instanceof Error ? loadError.message : 'Unable to load village authority data')
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

  const localRisk = riskClass(summary?.impact?.risk_level ?? summary?.latest_evaluation?.risk_level)
  const publicAlert = summary?.current_alert
  const alertRecommended = Boolean(summary?.latest_evaluation?.alert_recommended)
  const hasPublicWarning = Boolean(publicAlert && publicAlert.status !== 'pending_approval')
  const currentAlert = summary?.current_alert ?? null
  const latestDelivery = summary?.deliveries[0] ?? null

  async function submitReport() {
    if (!summary?.village.id || !summary.station?.id || !reportType || !severity) return
    setSubmitting(true)
    setSubmitState('')
    setError('')
    try {
      await submitDemoVillageReport({
        village_id: summary.village.id,
        station_id: summary.station.id,
        report_type: reportType,
        severity,
        description: description.trim() || undefined,
        latitude: summary.village.latitude,
        longitude: summary.village.longitude,
      })
      setDescription('')
      setSubmitState('Report stored in community_reports and sent through the same rule-engine path.')
      await loadSummary(summary.village.id)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="village-authority-page">
      <section className="va-heading panel">
        <div>
          <span className="section-kicker">VILLAGE AUTHORITY / SENTINEL-X</span>
          <h1>One village. One local operating view.</h1>
          <p>
            This workspace is intentionally scoped to a single village. In the authenticated version,
            this identity will come from <code>user_profiles.village_id</code>; for the demo, select the village below.
          </p>
        </div>
        <div className="va-demo-identity">
          <span>DEMO IDENTITY</span>
          <strong>Village Authority</strong>
          <small>{summary?.basin?.basin_name ?? 'Select a village'}</small>
        </div>
      </section>

      <section className="panel va-selector-card">
        <div className="va-selector-copy">
          <span className="section-kicker">LOCAL IDENTITY</span>
          <h2>Select assigned village</h2>
          <p>Only the selected village's conditions, warning delivery and community reports are loaded.</p>
        </div>
        <label className="va-select-wrap">
          <span>Village</span>
          <div className="va-select-control">
            <MapPin size={16} />
            <select
              value={selectedVillageId}
              onChange={(event) => {
                setSelectedVillageId(event.target.value)
                setSubmitState('')
                setDescription('')
              }}
              disabled={loadingVillages}
            >
              {loadingVillages ? <option value="">Loading villages…</option> : null}
              {villages.map((village) => (
                <option key={village.id} value={village.id}>{village.village_name}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </label>
      </section>

      {error ? <div className="panel va-error"><AlertTriangle size={17} /><span>{error}</span></div> : null}

      {loadingSummary ? (
        <div className="panel va-loading"><RefreshCw size={17} className="spin" /> Loading local operational data…</div>
      ) : summary ? (
        <>
          <section className={'va-status-card panel ' + localRisk}>
            <div className="va-status-top">
              <div>
                <span className="section-kicker">VILLAGE STATUS</span>
                <h2>{summary.village.village_name}</h2>
                <p>{summary.village.village_code} · {summary.village.district ?? 'District unavailable'} · {summary.village.state ?? 'State unavailable'}</p>
              </div>
              <div className="va-status-pill">
                <span>{hasPublicWarning ? 'PUBLIC WARNING' : alertRecommended ? 'REGIONAL ALERT RECOMMENDED' : 'MONITORING'}</span>
                <b>{hasPublicWarning ? riskLabel(summary.impact?.risk_level ?? summary.latest_evaluation?.risk_level) : alertRecommended ? 'AWAITING APPROVAL' : riskLabel(localRisk)}</b>
              </div>
            </div>
            <div className="va-metric-grid">
              <div><span>LOCAL RISK SCORE</span><strong>{summary.impact?.risk_score ?? summary.latest_evaluation?.total_score ?? '—'}/100</strong><small>{riskLabel(localRisk)}</small></div>
              <div><span>TIME TO IMPACT</span><strong>{formatEta(summary.impact?.time_to_impact_minutes ?? summary.alert_target?.time_to_impact_minutes)}</strong><small>{summary.impact?.downstream_order != null ? `Downstream #${summary.impact.downstream_order}` : 'No local ETA available'}</small></div>
              <div><span>POPULATION</span><strong>{formatNumber(summary.village.population)}</strong><small>Village population</small></div>
              <div><span>VULNERABILITY</span><strong>{summary.village.vulnerability_score ?? '—'}</strong><small>Stored village score</small></div>
            </div>
          </section>

          <div className="va-main-grid">
            <section className="panel va-hazard-card">
              <div className="panel-head compact"><div><span className="section-kicker">01 / STATION CONTEXT</span><h2>What your village is monitored against</h2></div><span className="va-source-chip">{summary.latest_reading?.data_mode?.toUpperCase() ?? 'NO DATA'}</span></div>
              <div className="va-context-grid">
                <div><span>Monitoring station</span><b>{summary.station?.station_name ?? '—'}</b></div>
                <div><span>Current water level</span><b>{summary.latest_reading?.water_level_m != null ? `${summary.latest_reading.water_level_m.toFixed(2)} m` : '—'}</b></div>
                <div><span>Observed</span><b>{formatTime(summary.latest_reading?.observed_at)}</b></div>
                <div><span>Danger threshold</span><b>{summary.station?.danger_level_m != null ? `${summary.station.danger_level_m.toFixed(2)} m` : '—'}</b></div>
              </div>
              <div className="va-rule-note"><Gauge size={16} /><div><b>Full evidence stays in Control Room</b><span>Level / rate / sensor / community / persistence breakdown and thresholds live on the Command View. This card shows only your village's monitoring context.</span></div></div>
            </section>

            <section className="panel va-alert-card">
              <div className="panel-head compact"><div><span className="section-kicker">02 / WARNING DELIVERY</span><h2>Local warning package</h2></div></div>
              {currentAlert ? (
                <>
                  <div className={'va-alert-banner ' + (summary.current_alert?.priority === 'P0' ? 'critical' : 'warning')}>
                    <div className="va-alert-icon"><AlertTriangle size={19} /></div>
                    <div><span>{currentAlert.priority ?? 'P3'} · {titleCase(currentAlert.status)}</span><b>{currentAlert.title}</b></div>
                  </div>
                  <p className="va-alert-copy">{currentAlert.description ?? 'Warning generated from the operational decision chain.'}</p>
                  <div className="va-instruction"><ShieldCheck size={15} /><span>{currentAlert.instruction ?? 'Follow local disaster-management instructions and move toward the designated safe area if directed.'}</span></div>
                </>
              ) : alertRecommended ? (
                <div className="va-alert-pending"><AlertTriangle size={19} /><div><b>Alert recommended by the rule engine</b><span>No local public dispatch is shown yet because the human authorization gate has not approved the warning.</span></div></div>
              ) : (
                <div className="va-alert-clear"><CheckCircle2 size={19} /><div><b>No local public warning</b><span>The latest decision data does not currently show an alert recommendation for this station.</span></div></div>
              )}
              <div className="va-delivery-summary">
                <div><span>Target status</span><b>{summary.alert_target?.target_status ? titleCase(summary.alert_target.target_status) : 'Not targeted'}</b></div>
                <div><span>Latest channel</span><b>{latestDelivery?.channel ? titleCase(latestDelivery.channel) : '—'}</b></div>
                <div><span>Latest delivery</span><b>{latestDelivery?.delivery_status ? titleCase(latestDelivery.delivery_status) : '—'}</b></div>
                <div><span>Delivery time</span><b>{formatTime(latestDelivery?.delivered_at ?? latestDelivery?.sent_at)}</b></div>
              </div>
            </section>
          </div>

          <section className="panel va-connectivity-card">
            <div className="panel-head compact"><div><span className="section-kicker">03 / LAST-MILE CONNECTIVITY</span><h2>How this village can receive a warning</h2></div><span className="va-source-chip">DEMO TELEMETRY</span></div>
            <div className="va-channel-grid">
              <div className={summary.village.internet_available ? 'active' : ''}><Wifi size={18} /><span>Internet</span><b>{summary.village.internet_available ? 'AVAILABLE' : 'OFFLINE'}</b></div>
              <div className={summary.village.cellular_available ? 'active' : ''}><TowerControl size={18} /><span>Cellular</span><b>{summary.village.cellular_available ? 'AVAILABLE' : 'OFFLINE'}</b></div>
              <div className={latestDelivery?.channel === 'lora' ? 'active' : ''}><Radio size={18} /><span>Offline relay</span><b>{latestDelivery?.channel === 'lora' ? 'RECENT DELIVERY' : 'STANDBY'}</b></div>
              <div><Smartphone size={18} /><span>Village device state</span><b>{latestDelivery?.delivery_status ? titleCase(latestDelivery.delivery_status) : 'NO RECORD'}</b></div>
            </div>
            <div className="va-connectivity-note"><CloudOff size={15} /><span>The local authority can see stored delivery records, but this phase does not fake live network telemetry or relay-phone state.</span></div>
          </section>

          <div className="va-main-grid">
            <section className="panel va-reports-card">
              <div className="panel-head compact"><div><span className="section-kicker">04 / COMMUNITY REPORTS</span><h2>Reports originating from this village</h2></div><span>{summary.reports.length} stored</span></div>
              {summary.reports.length ? (
                <div className="va-report-list">
                  {summary.reports.map((report) => (
                    <article key={report.id} className="va-report-row">
                      <div className="va-report-main"><div><b>{titleCase(report.report_type)}</b><span className={'va-severity ' + riskClass(report.severity)}>{report.severity.toUpperCase()}</span></div><p>{report.description || 'No description supplied.'}</p></div>
                      <div className="va-report-meta"><b>{titleCase(report.verification_status)}</b><span>{formatDateTime(report.submitted_at)}</span><small>{report.report_code ?? report.id.slice(0, 8)}</small></div>
                    </article>
                  ))}
                </div>
              ) : <div className="va-empty"><ClipboardList size={18} /><span>No community reports are stored for this village yet.</span></div>}
              <div className="va-data-boundary"><ShieldCheck size={15} /><span>The list is filtered by <code>community_reports.village_id</code>. No other village's report is loaded into this workspace.</span></div>
            </section>

            <section className="panel va-submit-card">
              <div className="panel-head compact"><div><span className="section-kicker">05 / LOCAL REPORTING</span><h2>Submit a village situation report</h2></div><span className="va-source-chip">SAME REPORT SCHEMA</span></div>
              <p className="va-form-intro">This demo form writes to <code>community_reports</code> with the selected village and its monitoring station, then sends the stored report through the existing rule-engine evaluation path.</p>
              <label><span>Observation type</span><select value={reportType} onChange={(event) => setReportType(event.target.value)} disabled={loadingOptions || submitting}>{reportOptions?.report_types.map((option: CommunityReportOption) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={loadingOptions || submitting}>{reportOptions?.severity_levels.map((option: CommunityReportOption) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="Describe what the village authority is observing…" disabled={submitting} /></label>
              <div className="va-form-location"><MapPin size={15} /><span>Location recorded from {summary.village.village_name} ({summary.village.latitude ?? '—'}, {summary.village.longitude ?? '—'})</span></div>
              <button className="primary-btn va-submit-btn" onClick={() => void submitReport()} disabled={submitting || !summary.station?.id || loadingOptions}><Send size={15} />{submitting ? 'Submitting…' : 'Submit local report'}</button>
              {submitState ? <div className="va-submit-success"><CheckCircle2 size={15} /><span>{submitState}</span></div> : null}
            </section>
          </div>

          <section className="panel va-auth-boundary">
            <ShieldCheck size={18} />
            <div><span className="section-kicker">AUTHENTICATION BOUNDARY</span><h2>Demo selector → future authenticated identity</h2><p>Today the selected village ID is held by the browser. When Supabase Auth is wired, the backend should derive <code>village_id</code> from the authenticated <code>user_profiles</code> record, ignore arbitrary village selection from the client, and apply the same summary/report logic to that authenticated village only.</p></div>
          </section>
        </>
      ) : selectedVillageId ? null : (
        <div className="panel va-empty"><MapPin size={18} /><span>Select a village to load the local authority workspace.</span></div>
      )}
    </div>
  )
}
