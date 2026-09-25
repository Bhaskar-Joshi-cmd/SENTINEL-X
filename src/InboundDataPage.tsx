import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Database,
  FileText,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Signal,
  Waves,
} from 'lucide-react'
import {
  getInboundSummary,
  submitSensorReading,
  reviewCommunityReport,
  type InboundCommunityRecord,
  type InboundEvaluationRecord,
  type InboundHydroRecord,
  type InboundSensorRecord,
  type InboundSummary,
} from './api'

type RiverCode = 'TEESTA' | 'DESANG'
type SourceFilter = 'all' | 'hydro' | 'sensor' | 'community' | 'evaluation'

type InboundRow = {
  id: string
  source: Exclude<SourceFilter, 'all'>
  sourceLabel: string
  sender: string
  observation: string
  location: string
  severity: string
  status: string
  timestamp: string
  raw: string
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatValue(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' ? value.toFixed(digits) : '—'
}

function pretty(value: string | null | undefined) {
  if (!value) return '—'
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function sourceIcon(source: InboundRow['source']) {
  if (source === 'hydro') return <Waves size={15} />
  if (source === 'sensor') return <Radio size={15} />
  if (source === 'community') return <FileText size={15} />
  return <Activity size={15} />
}

function buildRows(data: InboundSummary): InboundRow[] {
  const hydroRows: InboundRow[] = data.hydro.map((item: InboundHydroRecord) => ({
    id: `hydro-${item.id}`,
    source: 'hydro',
    sourceLabel: 'Hydrology',
    sender: `CWC · ${item.station_code}`,
    observation: `${formatValue(item.water_level_m)} m${item.water_level_rate_m_hr != null ? ` · ${formatValue(item.water_level_rate_m_hr)} m/hr` : ''}`,
    location: item.station_name || item.station_code,
    severity: item.water_level_m != null ? 'Observation' : 'No reading',
    status: pretty(item.data_mode ?? 'historical'),
    timestamp: item.observed_at,
    raw: item.data_mode ?? 'historical',
  }))

  const sensorRows: InboundRow[] = data.sensors.map((item: InboundSensorRecord) => ({
    id: `sensor-${item.id}`,
    source: 'sensor',
    sourceLabel: 'Field sensor',
    sender: `${item.sensor_code} · ${pretty(item.sensor_type)}`,
    observation: `${item.numeric_value ?? '—'} ${item.unit ?? ''}`.trim(),
    location: item.station_name ?? item.station_code ?? 'Unassigned station',
    severity: item.battery_percentage != null ? `Battery ${Math.round(item.battery_percentage)}%` : 'Reading received',
    status: item.quality_score != null ? `Quality ${Math.round(item.quality_score * 100)}%` : 'Received',
    timestamp: item.observed_at,
    raw: item.station_id ? 'Station-linked' : 'Unassigned',
  }))

  const communityRows: InboundRow[] = data.community.map((item: InboundCommunityRecord) => ({
    id: `community-${item.id}`,
    source: 'community',
    sourceLabel: 'Community report',
    sender: item.report_code,
    observation: pretty(item.report_type),
    location: item.village_name ?? item.station_name ?? 'Unknown location',
    severity: pretty(item.severity),
    status: pretty(item.verification_status),
    timestamp: item.submitted_at,
    raw: item.description ?? 'No description supplied',
  }))

  const evaluationRows: InboundRow[] = data.evaluations.map((item: InboundEvaluationRecord) => ({
    id: `evaluation-${item.id}`,
    source: 'evaluation',
    sourceLabel: 'Rule engine',
    sender: item.station_name ?? item.station_code ?? 'Decision engine',
    observation: `${formatValue(item.total_score, 1)} / 100 · ${pretty(item.risk_level)}`,
    location: item.station_name ?? 'Station',
    severity: item.alert_recommended ? 'Alert recommended' : 'Monitoring',
    status: item.alert_priority ?? 'No priority',
    timestamp: item.evaluated_at,
    raw: item.reasons?.join(' · ') ?? 'No rule reasons recorded',
  }))

  return [...hydroRows, ...sensorRows, ...communityRows, ...evaluationRows].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )
}

export function InboundDataPage({
  riverCode,
  onRiverChange,
  onRefresh,
  refreshToken,
}: {
  riverCode: RiverCode
  onRiverChange: (river: RiverCode) => void
  onRefresh: () => void
  refreshToken: number
}) {
  const [data, setData] = useState<InboundSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [sensorCode, setSensorCode] = useState('FIELD-WL-01')
  const [sensorType, setSensorType] = useState('water_level')
  const [sensorValue, setSensorValue] = useState('')
  const [sensorUnit, setSensorUnit] = useState('m')
  const [sensorKey, setSensorKey] = useState('')
  const [sensorBusy, setSensorBusy] = useState(false)
  const [sensorState, setSensorState] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setSelectedId(null)

    async function load() {
      try {
        const response = await getInboundSummary(riverCode, 50)
        if (cancelled) return
        setData(response)
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Unable to load inbound data')
        setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [riverCode, refreshToken])

  async function refreshInbound() {
    setActionError('')
    try {
      const response = await getInboundSummary(riverCode, 50)
      setData(response)
    } catch (loadError) {
      setActionError(loadError instanceof Error ? loadError.message : 'Unable to refresh inbound data')
    }
  }

  async function handleVerify(reportId: string, action: 'verified' | 'rejected' | 'request_clarification') {
    setActionBusyId(reportId)
    setActionError('')
    try {
      await reviewCommunityReport(reportId, { action })
      await refreshInbound()
    } catch (verifyError) {
      setActionError(verifyError instanceof Error ? verifyError.message : 'Unable to update report verification')
    } finally {
      setActionBusyId(null)
    }
  }

  async function handleSensorSubmit() {
    const numericValue = Number(sensorValue)
    if (!sensorCode.trim() || !Number.isFinite(numericValue)) {
      setSensorState('Enter a sensor code and a numeric reading first.')
      return
    }
    const stationId = data?.sensors.find((item) => item.station_id)?.station_id
      ?? data?.hydro.find((item) => item.station_id)?.station_id
      ?? null
    setSensorBusy(true)
    setSensorState('')
    setActionError('')
    try {
      await submitSensorReading(
        {
          sensor_code: sensorCode.trim(),
          sensor_type: sensorType,
          numeric_value: numericValue,
          unit: sensorUnit.trim() || 'm',
          station_id: stationId,
        },
        sensorKey.trim() || undefined,
      )
      setSensorValue('')
      setSensorState('Sensor reading stored and sent through the rule engine.')
      await refreshInbound()
    } catch (sensorError) {
      setSensorState('')
      setActionError(sensorError instanceof Error ? sensorError.message : 'Unable to submit sensor reading')
    } finally {
      setSensorBusy(false)
    }
  }

  const rows = useMemo(() => buildRows(data ?? {
    river: { id: '', basin_code: riverCode, basin_name: riverCode },
    counts: { hydro: 0, sensors: 0, community: 0, evaluations: 0 },
    latest_received_at: null,
    hydro: [], sensors: [], community: [], evaluations: [],
  }).filter((row) => {
    if (filter !== 'all' && row.source !== filter) return false
    if (!search.trim()) return true
    const needle = search.toLowerCase()
    return `${row.sender} ${row.observation} ${row.location} ${row.severity} ${row.status} ${row.raw}`.toLowerCase().includes(needle)
  }), [data, filter, search, riverCode])

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null

  return (
    <div className="inbound-page">
      <section className="inbound-page-head">
        <div>
          <span className="section-kicker">CONTROL ROOM / 02 — INBOUND DATA</span>
          <h1>Incoming operational evidence</h1>
          <p>See exactly what entered SENTINEL-X, who supplied it, where it belongs, and how the rule engine processed it. This page reads backend records; it does not generate simulated observations.</p>
        </div>
        <div className="inbound-head-actions">
          <label className="inbound-basin-select">
            <span>ACTIVE BASIN</span>
            <select value={riverCode} onChange={(event) => onRiverChange(event.target.value as RiverCode)}>
              <option value="DESANG">Desang / Nanglamoraghat</option>
              <option value="TEESTA">Teesta / Melli</option>
            </select>
          </label>
          <button className="inbound-refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </section>

      {error && <div className="inbound-error"><AlertTriangle size={16} /> {error}</div>}

      <section className="inbound-source-summary">
        <SummaryCard icon={<Waves size={17} />} label="HYDRO OBSERVATIONS" value={data?.counts.hydro ?? 0} detail="CWC station records" />
        <SummaryCard icon={<Radio size={17} />} label="FIELD SENSORS" value={data?.counts.sensors ?? 0} detail="ESP32 / sensor readings" />
        <SummaryCard icon={<FileText size={17} />} label="COMMUNITY REPORTS" value={data?.counts.community ?? 0} detail="Local observations" />
        <SummaryCard icon={<ShieldCheck size={17} />} label="RULE EVALUATIONS" value={data?.counts.evaluations ?? 0} detail="Decision records" />
      </section>

      <section className="panel inbound-panel">
        <div className="inbound-panel-head">
          <div>
            <span className="section-kicker">EVIDENCE STREAM</span>
            <h2>Who sent what</h2>
          </div>
          <div className="inbound-filter-bar">
            {(['all', 'hydro', 'sensor', 'community', 'evaluation'] as SourceFilter[]).map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
                {item === 'all' ? 'All' : item === 'hydro' ? 'Hydro' : item === 'sensor' ? 'Sensors' : item === 'community' ? 'Community' : 'Evaluations'}
              </button>
            ))}
            <label className="inbound-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sender, village, observation…" /></label>
          </div>
        </div>

        {loading ? (
          <div className="inbound-empty"><Activity size={17} /> Loading inbound records…</div>
        ) : rows.length ? (
          <div className="inbound-table">
            <div className="inbound-table-head"><span>SOURCE / SENDER</span><span>OBSERVATION</span><span>LOCATION</span><span>STATUS</span><span>TIME</span></div>
            {rows.map((row) => (
              <button key={row.id} className={`inbound-row ${selectedId === row.id ? 'selected' : ''}`} onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}>
                <span className="inbound-source-cell"><i>{sourceIcon(row.source)}</i><b>{row.sourceLabel}</b><small>{row.sender}</small></span>
                <span><b>{row.observation}</b><small>{row.severity}</small></span>
                <span><b>{row.location}</b><small>{row.source === 'hydro' ? 'Monitoring station' : row.source === 'sensor' ? 'Field source' : row.source === 'community' ? 'Local report' : 'Decision record'}</small></span>
                <span><strong className={`inbound-status ${row.status.toLowerCase().includes('verified') || row.status.toLowerCase().includes('active') ? 'positive' : ''}`}>{row.status}</strong></span>
                <span className="inbound-time">{formatTime(row.timestamp)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="inbound-empty"><Database size={17} /> No inbound records match this filter.</div>
        )}
      </section>

      <section className="inbound-bottom-grid">
        <section className="panel inbound-detail-card">
          <div className="inbound-panel-head compact">
            <div><span className="section-kicker">SELECTED RECORD</span><h2>Evidence detail</h2></div>
            <span className="inbound-live-state"><Signal size={12} /> Backend record</span>
          </div>
          {selectedRow ? (
            <div className="inbound-detail-grid">
              <Detail label="Source" value={selectedRow.sourceLabel} />
              <Detail label="Sender" value={selectedRow.sender} />
              <Detail label="Observation" value={selectedRow.observation} />
              <Detail label="Location" value={selectedRow.location} />
              <Detail label="Status" value={selectedRow.status} />
              <Detail label="Severity / type" value={selectedRow.severity} />
              <Detail label="Received / observed" value={formatTime(selectedRow.timestamp)} />
              <Detail label="Backend note" value={selectedRow.raw} wide />
            </div>
          ) : (
            <div className="inbound-empty compact-empty">Select a record above to inspect its operational details.</div>
          )}
          {selectedRow?.source === 'community' && (
            <div className="inbound-verify-row">
              <button
                className="inbound-verify approve"
                disabled={actionBusyId === selectedRow.id}
                onClick={() => void handleVerify(selectedRow.id.replace('community-', ''), 'verified')}
              >
                {actionBusyId === selectedRow.id ? 'Updating…' : 'Mark verified'}
              </button>
              <button
                className="inbound-verify reject"
                disabled={actionBusyId === selectedRow.id}
                onClick={() => void handleVerify(selectedRow.id.replace('community-', ''), 'rejected')}
              >
                Mark rejected
              </button>
              <button
                className="inbound-verify clarify"
                disabled={actionBusyId === selectedRow.id}
                onClick={() => void handleVerify(selectedRow.id.replace('community-', ''), 'request_clarification')}
              >
                Request clarification
              </button>
              <span className="inbound-note">This is the Control Room review step. Field confirmation is recorded by the village Community Manager and corroboration by the Village Authority.</span>
            </div>
          )}
          {actionError && <div className="inbound-error compact">{actionError}</div>}
        </section>

        <section className="panel inbound-flow-card">
          <div className="inbound-panel-head compact">
            <div><span className="section-kicker">FIELD SENSOR INGEST</span><h2>Submit a station-linked reading</h2></div>
          </div>
          <div className="inbound-sensor-form">
            <label><span>Sensor code</span><input value={sensorCode} onChange={(event) => setSensorCode(event.target.value)} placeholder="FIELD-WL-01" /></label>
            <label><span>Type</span>
              <select value={sensorType} onChange={(event) => setSensorType(event.target.value)}>
                <option value="water_level">water_level (+10)</option>
                <option value="seismic">seismic (+5)</option>
                <option value="vibration">vibration (+5)</option>
                <option value="camera">camera (+5)</option>
                <option value="rainfall">rainfall (logged)</option>
                <option value="other">other (logged)</option>
              </select>
            </label>
            <label><span>Value</span><input value={sensorValue} onChange={(event) => setSensorValue(event.target.value)} placeholder="e.g. 229.4" inputMode="decimal" /></label>
            <label><span>Unit</span><input value={sensorUnit} onChange={(event) => setSensorUnit(event.target.value)} placeholder="m" /></label>
            <label><span>Sensor key</span><input value={sensorKey} onChange={(event) => setSensorKey(event.target.value)} placeholder="x-sensor-key (if configured)" /></label>
          </div>
          <button className="inbound-verify approve full" disabled={sensorBusy} onClick={() => void handleSensorSubmit()}>
            {sensorBusy ? 'Submitting…' : 'Submit sensor reading'}
          </button>
          {sensorState && <div className="inbound-note positive">{sensorState}</div>}
          <div className="inbound-panel-head compact" style={{ marginTop: 12 }}>
            <div><span className="section-kicker">PROCESSING CHAIN</span><h2>Where the data goes</h2></div>
          </div>
          <div className="inbound-flow">
            <FlowStep icon={<Database size={15} />} title="Received" detail="Persisted in Supabase" />
            <div className="flow-arrow">↓</div>
            <FlowStep icon={<Activity size={15} />} title="Evaluated" detail="Same rule engine" />
            <div className="flow-arrow">↓</div>
            <FlowStep icon={<ShieldCheck size={15} />} title="Decision evidence" detail="Feeds alert / impact workflow" />
          </div>
          <div className="inbound-note"><Signal size={14} /> Latest backend record: {formatTime(data?.latest_received_at)}</div>
        </section>
      </section>
    </div>
  )
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: number; detail: string }) {
  return <div className="panel inbound-summary-card"><div className="summary-icon">{icon}</div><span>{label}</span><strong>{value.toLocaleString('en-IN')}</strong><small>{detail}</small></div>
}

function Detail({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? 'detail-item wide' : 'detail-item'}><span>{label}</span><b>{value || '—'}</b></div>
}

function FlowStep({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="flow-step"><i>{icon}</i><div><b>{title}</b><span>{detail}</span></div></div>
}
