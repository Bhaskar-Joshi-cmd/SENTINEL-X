import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Droplets,
  Gauge,
  MapPinned,
  ShieldCheck,
  Siren,
  Users,
  XCircle,
} from 'lucide-react'
import {
  approveAlert,
  rejectAlert,
  type Alert,
  type ImpactAssessment,
  type RuleEvaluation,
  type Station,
  type HydroReading,
} from './api'

export type DisasterAuthorityZone = {
  id: string
  name: string
  risk: string
  riskScore: number | null
  eta: number | null
  population: number
  vulnerability: number
  downstreamOrder: number | null
}

type Props = {
  riverCode: 'TEESTA' | 'DESANG'
  station: Station | undefined
  reading: HydroReading | null | undefined
  latestEvaluation: RuleEvaluation | null
  activeAlert: Alert | null
  zones: DisasterAuthorityZone[]
  impactAssessments: ImpactAssessment[]
  totalPopulationAtRisk: number
  onReviewAlert: () => void
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

function formatEta(value: number | null | undefined) {
  return typeof value === 'number' ? `${Math.round(value)} min` : '—'
}

function riskTone(value: string | null | undefined) {
  return String(value ?? 'standby').toLowerCase()
}

function impactByVillage(items: ImpactAssessment[]) {
  return new Map(items.map((item) => [item.village_id, item]))
}

function DecisionMetric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <div className="da-metric">
      <div className="da-metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function ScoreBar({ label, score, max }: { label: string; score: number | null | undefined; max: number }) {
  const value = typeof score === 'number' ? Math.max(0, Math.min(max, score)) : 0
  const width = `${Math.round((value / max) * 100)}%`
  return (
    <div className="da-score-row">
      <div className="da-score-label"><span>{label}</span><b>{typeof score === 'number' ? score.toFixed(1) : '—'} / {max}</b></div>
      <div className="da-score-track"><span style={{ width }} /></div>
    </div>
  )
}

export default function DisasterAuthorityPage({
  riverCode,
  station,
  reading,
  latestEvaluation,
  activeAlert,
  zones,
  impactAssessments,
  totalPopulationAtRisk,
  onReviewAlert,
}: Props) {
  const impacts = impactByVillage(impactAssessments)
  const sortedZones = [...zones].sort((a, b) => (a.downstreamOrder ?? 999) - (b.downstreamOrder ?? 999))
  const highestRisk = [...sortedZones].sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1))[0]
  const nearest = [...impactAssessments].sort((a, b) => a.time_to_impact_minutes - b.time_to_impact_minutes)[0]
  const recommended = Boolean(latestEvaluation?.alert_recommended || activeAlert)
  const [decisionBusy, setDecisionBusy] = useState<null | 'approve' | 'reject'>(null)
  const [decisionNote, setDecisionNote] = useState('')
  const alertReviewed = activeAlert
    ? ['approved', 'dispatching', 'active', 'cancelled', 'expired'].includes(activeAlert.status)
    : false

  async function decideAlert(kind: 'approve' | 'reject') {
    if (!activeAlert || alertReviewed) return
    setDecisionBusy(kind)
    setDecisionNote('')
    try {
      const response = kind === 'approve'
        ? await approveAlert(activeAlert.id)
        : await rejectAlert(activeAlert.id)
      setDecisionNote(
        kind === 'approve'
          ? `Warning authorized (${response.alert.status.replaceAll('_', ' ')}). Impact assessment and last-mile dispatch are now moving through the delivery chain.`
          : 'Warning package refused by the authority (recorded as cancelled). The rule engine re-evaluates on the next observation and may raise a fresh recommendation.',
      )
    } catch (actionError) {
      setDecisionNote(actionError instanceof Error ? actionError.message : 'Unable to record the authorization decision')
    } finally {
      setDecisionBusy(null)
    }
  }

  return (
    <div className="disaster-authority-page">
      <section className="panel da-context-card">
        <div>
          <span className="section-kicker">DISASTER AUTHORITY / REGIONAL SITUATION</span>
          <h1>Regional emergency decision view</h1>
          <p>One-page regional picture for deciding whether the current hazard requires coordinated public action.</p>
        </div>
        <div className="da-context-meta">
          <span>ACTIVE BASIN</span>
          <strong>{riverCode === 'TEESTA' ? 'Teesta / Melli' : 'Desang / Nanglamoraghat'}</strong>
          <small>{station?.station_name ?? 'Station unavailable'} · updated {formatTime(reading?.observed_at)}</small>
        </div>
      </section>

      <section className="da-metric-grid">
        <DecisionMetric
          label="REGIONAL RISK"
          value={latestEvaluation ? `${latestEvaluation.total_score}/100` : '—'}
          detail={latestEvaluation?.risk_level?.toUpperCase() ?? 'No evaluation'}
          icon={<Gauge size={18} />}
        />
        <DecisionMetric
          label="POPULATION AT RISK"
          value={formatNumber(totalPopulationAtRisk)}
          detail={`${impactAssessments.length} assessed villages`}
          icon={<Users size={18} />}
        />
        <DecisionMetric
          label="NEAREST IMPACT"
          value={formatEta(nearest?.time_to_impact_minutes)}
          detail={nearest ? (highestRisk?.name ?? 'Assessed village') : 'No ETA available'}
          icon={<Clock3 size={18} />}
        />
        <DecisionMetric
          label="ALERT READINESS"
          value={activeAlert ? (activeAlert.priority ?? 'P3') : recommended ? 'REVIEW' : 'NONE'}
          detail={activeAlert ? activeAlert.status.replaceAll('_', ' ') : recommended ? 'Human decision required' : 'Monitoring only'}
          icon={<Siren size={18} />}
        />
      </section>

      <section className="da-main-grid">
        <section className="panel da-hazard-card">
          <div className="panel-head compact">
            <div>
              <span className="section-kicker">01 / HAZARD STATE</span>
              <h2>{station?.river_name ?? (riverCode === 'TEESTA' ? 'Teesta' : 'Desang')} · {station?.station_name ?? 'Station'}</h2>
            </div>
            <span className={'risk-summary ' + riskTone(latestEvaluation?.risk_level)}>
              {latestEvaluation?.risk_level?.toUpperCase() ?? 'STANDBY'}
            </span>
          </div>

          <div className="da-hazard-level">
            <div>
              <span>Current water level</span>
              <strong>{reading?.water_level_m != null ? `${Number(reading.water_level_m).toFixed(2)} m` : '—'}</strong>
            </div>
            <div>
              <span>Rise rate</span>
              <strong>{reading?.water_level_rate_m_hr != null ? `${Number(reading.water_level_rate_m_hr).toFixed(2)} m/hr` : '—'}</strong>
            </div>
            <div>
              <span>Observed</span>
              <strong>{formatTime(reading?.observed_at)}</strong>
            </div>
          </div>

          <div className="da-threshold-grid">
            <div><span>Warning</span><b>{station?.warning_level_m != null ? `${Number(station.warning_level_m).toFixed(2)} m` : '—'}</b></div>
            <div><span>Danger</span><b>{station?.danger_level_m != null ? `${Number(station.danger_level_m).toFixed(2)} m` : '—'}</b></div>
            <div><span>HFL</span><b>{station?.highest_flood_level_m != null ? `${Number(station.highest_flood_level_m).toFixed(2)} m` : '—'}</b></div>
          </div>

          <div className="da-hazard-note">
            <Droplets size={16} />
            <span>The authority view treats the station reading as the regional hazard signal; village risk and ETA come separately from the impact assessment.</span>
          </div>
        </section>

        <section className="panel da-alert-card">
          <div className="panel-head compact">
            <div><span className="section-kicker">02 / DECISION GATE</span><h2>Public warning readiness</h2></div>
            <span className={'status-badge ' + (recommended ? 'pending' : 'normal')}>
              {activeAlert ? 'ACTIVE REVIEW' : recommended ? 'REVIEW REQUIRED' : 'NO ALERT'}
            </span>
          </div>

          {activeAlert ? (
            <>
              <div className="da-alert-identity">
                <div className="da-alert-icon"><AlertTriangle size={20} /></div>
                <div><b>{activeAlert.title}</b><span>{activeAlert.priority ?? 'P3'} · {activeAlert.severity ?? 'Advisory'} · {activeAlert.status.replaceAll('_', ' ')}</span></div>
              </div>
              <p className="da-alert-copy">{activeAlert.description ?? 'This warning package was generated from the current decision record.'}</p>
              {activeAlert.instruction && <div className="da-instruction"><ShieldCheck size={16} /><span>{activeAlert.instruction}</span></div>}
              <button className="primary-btn" onClick={onReviewAlert}><ShieldCheck size={16} /> Review authorization package <ArrowRight size={15} /></button>
              <div className="da-authorization-actions">
                <button
                  className="primary-btn"
                  disabled={decisionBusy !== null || alertReviewed}
                  onClick={() => void decideAlert('approve')}
                >
                  <ShieldCheck size={16} /> {decisionBusy === 'approve' ? 'Authorizing…' : 'Approve & dispatch'}
                </button>
                <button
                  className="outline-btn"
                  disabled={decisionBusy !== null || alertReviewed}
                  onClick={() => void decideAlert('reject')}
                >
                  <XCircle size={16} /> {decisionBusy === 'reject' ? 'Recording…' : 'Reject warning'}
                </button>
              </div>
              {decisionNote && <div className="da-instruction"><ShieldCheck size={16} /><span>{decisionNote}</span></div>}
            </>
          ) : (
            <div className="da-empty-alert">
              <CheckCircle2 size={20} />
              <div><b>No public warning currently queued</b><span>The authority dashboard will surface a review package when the rule engine recommends an alert.</span></div>
            </div>
          )}

          <div className="da-authorization-note">
            {alertReviewed && activeAlert
              ? `Alert already ${activeAlert.status.replaceAll('_', ' ')} — the authorization decision is recorded and cannot be repeated for this package.`
              : 'Authorization is an explicit human decision. Control Room verifies evidence and recommends; only the Disaster Authority can approve or reject official dispatch, and every decision is written to the approval trail.'}
          </div>
        </section>
      </section>

      <section className="da-main-grid">
        <section className="panel da-evidence-card">
          <div className="panel-head compact"><div><span className="section-kicker">03 / DECISION EVIDENCE</span><h2>Why the engine reached this state</h2></div><span>{latestEvaluation?.engine_version ?? '—'}</span></div>
          <div className="da-score-list">
            <ScoreBar label="River level" score={latestEvaluation?.level_score} max={60} />
            <ScoreBar label="Rise rate" score={latestEvaluation?.rate_score} max={20} />
            <ScoreBar label="Sensor confirmation" score={latestEvaluation?.sensor_score} max={10} />
            <ScoreBar label="Community evidence" score={latestEvaluation?.community_score} max={5} />
            <ScoreBar label="Persistence" score={latestEvaluation?.persistence_score} max={5} />
          </div>
          <div className="da-reasons">
            <span className="section-kicker">ENGINE NOTES</span>
            {(latestEvaluation?.reasons ?? ['No evaluation evidence is currently available.']).map((reason) => <div key={reason}><MapPinned size={14} /><span>{reason}</span></div>)}
          </div>
        </section>

        <section className="panel da-impact-card">
          <div className="panel-head compact"><div><span className="section-kicker">04 / REGIONAL IMPACT</span><h2>Affected villages</h2></div><span>{sortedZones.length} in view</span></div>
          <div className="da-village-table">
            <div className="da-table-head"><span>Village</span><span>Risk</span><span>ETA</span><span>Population</span></div>
            {sortedZones.length ? sortedZones.map((zone) => {
              const impact = impacts.get(zone.id)
              return (
                <div className="da-table-row" key={zone.id}>
                  <div><b>{zone.name}</b><small>Downstream #{zone.downstreamOrder ?? impact?.downstream_order ?? '—'}</small></div>
                  <div><span className={'risk-summary ' + riskTone(zone.risk)}>{zone.risk}</span><small>{zone.riskScore != null ? `${Math.round(zone.riskScore)}/100` : '—'}</small></div>
                  <div><b>{formatEta(impact?.time_to_impact_minutes ?? zone.eta)}</b></div>
                  <div><b>{formatNumber(impact?.population_at_risk ?? zone.population)}</b></div>
                </div>
              )
            }) : <div className="da-empty-table">No village impact assessment is currently available.</div>}
          </div>
          <div className="da-impact-foot">Impact values are backend assessments. Prototype ETA/order values are not a terrain-derived evacuation forecast.</div>
        </section>
      </section>

      <section className="panel da-provenance-card">
        <div><span className="section-kicker">05 / DATA BOUNDARY</span><h2>What this page is for</h2></div>
        <div className="da-provenance-grid">
          <div><b>Decision input</b><span>Station telemetry, rule evaluation and active alert state.</span></div>
          <div><b>Regional consequence</b><span>Village impact, ETA and population at risk.</span></div>
          <div><b>Authority action</b><span>Review the warning package and make the human authorization decision.</span></div>
          <div><b>Not shown here</b><span>Low-level ingestion records and last-mile delivery operations remain in Control Room workspaces.</span></div>
        </div>
      </section>
    </div>
  )
}
