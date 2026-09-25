import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BatteryMedium,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  CloudRain,
  Crosshair,
  Database,
  Gauge,
  Info,
  LocateFixed,
  MapPin,
  Menu,
  Radio,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  Signal,
  Siren,
  Smartphone,
  TimerReset,
  TowerControl,
  Waves,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import {
  getAlert,
  getAlertImpact,
  getDashboardSummary,
  getHydroReadings,
  getVillages,
  replayTick,
  sendRelayAlert,
  type Alert,
  type DashboardSummary,
  type ImpactAssessment,
  type ReplayTickStation,
  type Village,
} from './api'
import { RoleWorkspace, type RoleKey } from './roleWorkspaces'
import ConnectivityPage from './ConnectivityPage'
import { InboundDataPage } from './InboundDataPage'
import { VillageDeliveryPage } from './VillageDeliveryPage'
import './command-view.css'

type RiverCode = 'TEESTA' | 'DESANG'
type NetworkKey = 'internet' | 'cellular' | 'mesh'

type Zone = {
  id: string
  name: string
  risk: string
  riskScore: number | null
  eta: number | null
  coverage: number
  status: string
  x: number
  y: number
  color: string
  population: number
  vulnerability: number
  downstreamOrder: number | null
}

const DEFAULT_RIVER: RiverCode = 'DESANG'

// Keep the brand copy centralized so the exact Sentinel-X expansion from the pitch deck
// can be inserted here later without touching the UI components.
const PRODUCT_NAME = 'SENTINEL-X'
const PRODUCT_DESCRIPTOR = 'Resilient emergency warning & last-mile network'
const TAGLINE = "When the network dies, the warning doesn't."

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function riskLabel(riskLevel: string | null | undefined) {
  const normalized = (riskLevel ?? 'watch').toLowerCase()
  if (normalized === 'critical') return 'CRITICAL'
  if (normalized === 'high') return 'HIGH'
  if (normalized === 'warning') return 'WARNING'
  if (normalized === 'watch') return 'WATCH'
  // Live preview vocabulary from the impact engine — map to the closest
  // displayed band so a real numeric score never renders beside 'NORMAL'.
  if (normalized === 'moderate') return 'WARNING'
  if (normalized === 'low') return 'WATCH'
  return 'NORMAL'
}

function riskColor(riskLevel: string | null | undefined) {
  const normalized = (riskLevel ?? 'watch').toLowerCase()
  if (normalized === 'critical' || normalized === 'high') return '#ff6b4a'
  if (normalized === 'warning' || normalized === 'moderate') return '#f3c969'
  if (normalized === 'watch' || normalized === 'low') return '#74c69d'
  return '#72d9c6'
}

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('en-IN') : '—'
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function dateTime(value: string | null | undefined) {
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

function formatEta(value: number | null | undefined) {
  if (typeof value !== 'number') return '—'
  return `${Math.round(value)} min`
}

function buildRoutePath(zones: Zone[]) {
  if (zones.length < 2) return ''
  const [first, ...rest] = zones
  return [
    `M ${first.x} ${first.y}`,
    ...rest.map((zone, index) => {
      const previous = index === 0 ? first : rest[index - 1]
      const midX = (previous.x + zone.x) / 2
      return `Q ${midX} ${previous.y}, ${zone.x} ${zone.y}`
    }),
  ].join(' ')
}

function projectVillages(villages: Village[], impacts: ImpactAssessment[], fallbackRisk: string) {
  const usable = villages.filter((v) => typeof v.latitude === 'number' && typeof v.longitude === 'number')
  if (!usable.length) return [] as Zone[]

  const minLat = Math.min(...usable.map((v) => v.latitude as number))
  const maxLat = Math.max(...usable.map((v) => v.latitude as number))
  const minLon = Math.min(...usable.map((v) => v.longitude as number))
  const maxLon = Math.max(...usable.map((v) => v.longitude as number))
  const latSpan = Math.max(maxLat - minLat, 0.0001)
  const lonSpan = Math.max(maxLon - minLon, 0.0001)
  const impactByVillage = new Map(impacts.map((impact) => [impact.village_id, impact]))

  return [...usable]
    .sort((a, b) => {
      const aOrder = impactByVillage.get(a.id)?.downstream_order ?? Number.MAX_SAFE_INTEGER
      const bOrder = impactByVillage.get(b.id)?.downstream_order ?? Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) return aOrder - bOrder
      return (b.vulnerability_score ?? 0) - (a.vulnerability_score ?? 0)
    })
    .map((village) => {
      const impact = impactByVillage.get(village.id)
      const risk = impact?.risk_level ?? fallbackRisk
      return {
        id: village.id,
        name: village.village_name,
        risk: riskLabel(risk),
        riskScore: impact?.risk_score ?? null,
        eta: impact?.time_to_impact_minutes ?? null,
        coverage: 0,
        status: 'unreached',
        x: 16 + (((village.longitude as number) - minLon) / lonSpan) * 68,
        y: 21 + (1 - ((village.latitude as number) - minLat) / latSpan) * 58,
        color: riskColor(risk),
        population: village.population ?? 0,
        vulnerability: village.vulnerability_score ?? 0,
        downstreamOrder: impact?.downstream_order ?? null,
      }
    })
}

function mergeImpact(zones: Zone[], impacts: ImpactAssessment[]) {
  const impactByVillage = new Map(impacts.map((impact) => [impact.village_id, impact]))
  return zones.map((zone) => {
    const impact = impactByVillage.get(zone.id)
    if (!impact) return zone
    return {
      ...zone,
      risk: riskLabel(impact.risk_level),
      riskScore: impact.risk_score,
      eta: impact.time_to_impact_minutes,
      downstreamOrder: impact.downstream_order ?? null,
      color: riskColor(impact.risk_level),
    }
  })
}

function buildZonePolyline(zones: Zone[]) {
  if (zones.length < 1) return ''
  const first = zones[0]
  return [`16,23`, `${first.x},${first.y}`, ...zones.slice(1).map((zone) => `${zone.x},${zone.y}`)].join(' ')
}

function ThresholdCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`command-v4-threshold ${tone}`}><span>{label}</span><b>{value}</b></div>
}

function Factor({ label, value, max }: { label: string; value?: number | null; max: number }) {
  const actual = typeof value === 'number' ? value : 0
  const width = Math.max(0, Math.min(100, (actual / max) * 100))
  return <div className="command-v4-factor"><div><span>{label}</span><b>{typeof value === 'number' ? `${value.toFixed(1)}/${max}` : '—'}</b></div><div className="command-v4-factor-track"><span style={{ width: `${width}%` }} /></div></div>
}

function ControlRoomPanel({
  section,
  station,
  reading,
  latestEvaluation,
  activeAlert,
  dashboard,
  zones,
  networks,
  totalPopulationAtRisk,
  onReviewAlert,
}: {
  section: string
  station: any
  reading: any
  latestEvaluation: any
  activeAlert: Alert | null
  dashboard: DashboardSummary | null
  zones: Zone[]
  networks: Record<NetworkKey, boolean>
  totalPopulationAtRisk: number
  onReviewAlert: () => void
}) {
  if (section === 'Inbound data') {
    return <div className="control-subpage">
      <section className="subpage-heading"><span className="section-kicker">CONTROL ROOM / INBOUND DATA</span><h1>Who sent what data</h1><p>Trace the operational inputs currently feeding the rule engine. Source identity is shown separately from the risk decision.</p></section>
      <div className="control-card-grid">
        <section className="panel control-card"><span className="section-kicker">HYDROLOGICAL SOURCE</span><h2>{station?.station_name ?? 'No station'}</h2><div className="data-row"><b>CWC</b><span>Historical / replayed station observation</span></div><div className="data-row"><b>Water level</b><span>{reading?.water_level_m != null ? `${Number(reading.water_level_m).toFixed(2)} m` : '—'}</span></div><div className="data-row"><b>Observed</b><span>{formatTime(reading?.observed_at)}</span></div></section>
        <section className="panel control-card"><span className="section-kicker">SENSOR INPUT</span><h2>Field sensor channel</h2><div className="data-row"><b>Path</b><span>ESP32 / Wokwi → FastAPI → Supabase</span></div><div className="data-row"><b>Purpose</b><span>Independent sensor confirmation</span></div><div className="data-row"><b>Decision</b><span>{latestEvaluation?.sensor_score ?? '—'} / 10 sensor score</span></div></section>
        <section className="panel control-card"><span className="section-kicker">COMMUNITY INPUT</span><h2>Local reports</h2><div className="data-row"><b>Path</b><span>Community app → reports API → rule engine</span></div><div className="data-row"><b>Current contribution</b><span>{latestEvaluation?.community_score ?? '0'} / 5</span></div><div className="data-row"><b>Verification</b><span>Verified reports contribute to scoring</span></div></section>
        <section className="panel control-card"><span className="section-kicker">DECISION OUTPUT</span><h2>Rule engine</h2><div className="data-row"><b>Score</b><span>{latestEvaluation?.total_score ?? '—'} / 100</span></div><div className="data-row"><b>Risk</b><span>{latestEvaluation?.risk_level?.toUpperCase() ?? '—'}</span></div><div className="data-row"><b>Alert</b><span>{latestEvaluation?.alert_recommended ? 'Recommended' : 'Not recommended'}</span></div></section>
      </div>
    </div>
  }

  if (section === 'Village delivery') {
    return <div className="control-subpage">
      <section className="subpage-heading"><span className="section-kicker">CONTROL ROOM / VILLAGE DELIVERY</span><h1>Who receives what</h1><p>One operational view of the warning package, affected village, delivery path and current last-mile state.</p></section>
      <section className="panel delivery-board">
        <div className="delivery-board-head"><span>VILLAGE</span><span>RISK / ETA</span><span>POPULATION</span><span>WARNING PACKAGE</span><span>PATH</span></div>
        {zones.length ? zones.map((zone) => <div className="delivery-board-row" key={zone.id}><div><b>{zone.name}</b><small>Downstream #{zone.downstreamOrder ?? '—'}</small></div><div><strong className={'risk-pill '+zone.risk.toLowerCase()}>{zone.risk}</strong><small>{formatEta(zone.eta)}</small></div><div>{formatNumber(zone.population)}</div><div><b>{activeAlert?.title ?? 'No active public warning'}</b><small>{activeAlert ? 'Pending human authorization' : 'Monitoring only'}</small></div><div><b>{networks.internet ? 'Internet' : networks.cellular ? 'Cellular' : networks.mesh ? 'Offline relay' : 'Unavailable'}</b><small>{zone.coverage}% simulated delivery</small></div></div>) : <div className="empty-state">No village assessment loaded.</div>}
      </section>
      <section className="panel visibility-card"><div className="panel-head compact"><div><span className="section-kicker">ROLE VISIBILITY</span><h2>What each role is shown</h2></div></div><div className="visibility-grid"><div><b>Control Room</b><span>All operational data, inbound evidence, impact and delivery state.</span></div><div><b>Disaster Authority</b><span>Regional risk, population at risk and authorization readiness.</span></div><div><b>Village Authority</b><span>Only the local warning, village conditions and local reporting tools.</span></div><div><b>Community Member</b><span>Actionable warning, ETA, acknowledgement and local reporting.</span></div><div><b>System Admin</b><span>Platform health, integrations and authorization directory.</span></div></div></section>
    </div>
  }

  if (section === 'Connectivity') {
    return <div className="control-subpage"><section className="subpage-heading"><span className="section-kicker">CONTROL ROOM / CONNECTIVITY</span><h1>Last-mile network state</h1><p>Monitor the available communication paths and the fallback route used when infrastructure fails.</p></section><div className="connectivity-grid">{[['Internet / cloud', networks.internet, 'Primary backend path'],['Cellular towers', networks.cellular, 'Carrier delivery path'],['Offline mesh', networks.mesh, 'Phone-to-phone fallback']].map(([label, active, detail]) => <section className="panel connectivity-card" key={label as string}><div className="connectivity-icon">{active ? <Wifi size={20}/> : <WifiOff size={20}/>}</div><b>{label as string}</b><span>{detail as string}</span><strong>{active ? 'AVAILABLE' : 'OFFLINE'}</strong></section>)}</div><section className="panel control-note"><Radio size={16}/><span>The network twin controls remain simulation controls in this prototype; they do not represent a live physical LoRa link.</span></section></div>
  }

  return <div className="control-subpage"><section className="subpage-heading"><span className="section-kicker">CONTROL ROOM / AUDIT</span><h1>Operational activity</h1><p>Review the current decision chain without changing alert state from the dashboard.</p></section><div className="audit-list"><div><span>01</span><b>Hazard observation</b><small>{station?.station_name ?? 'Station'} · {formatTime(reading?.observed_at)}</small></div><div><span>02</span><b>Rule evaluation</b><small>{latestEvaluation?.total_score ?? '—'}/100 · {latestEvaluation?.risk_level ?? '—'}</small></div><div><span>03</span><b>Impact assessment</b><small>{zones.length} villages · {formatNumber(totalPopulationAtRisk)} people at risk</small></div><div><span>04</span><b>Alert gate</b><small>{activeAlert ? `${activeAlert.priority ?? 'P3'} · ${activeAlert.status.replaceAll('_',' ')}` : 'No active alert'}</small></div></div><section className="panel control-note"><ShieldCheck size={16}/><span>Approval remains a protected backend action. This workspace only exposes the review package until Supabase Auth is wired.</span>{activeAlert && <button className="outline-btn" onClick={onReviewAlert}>Review alert</button>}</section></div>
}

function App() {
  const [riverCode, setRiverCode] = useState<RiverCode>(DEFAULT_RIVER)
  const [villages, setVillages] = useState<Village[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
  const [impactAssessments, setImpactAssessments] = useState<ImpactAssessment[]>([])
  const [started, setStarted] = useState(false)
  const [tick, setTick] = useState(0)
  const [networks, setNetworks] = useState<Record<NetworkKey, boolean>>({ internet: true, cellular: true, mesh: false })
  const [activeTab, setActiveTab] = useState('Command view')
  const [selectedRole, setSelectedRole] = useState<RoleKey>('control_room')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationState, setNotificationState] = useState<'idle' | 'sent' | 'blocked'>('idle')
  const [loading, setLoading] = useState(true)
  const [impactLoading, setImpactLoading] = useState(false)
  const [error, setError] = useState('')
  const [impactError, setImpactError] = useState('')
  const [selectedVillageId, setSelectedVillageId] = useState<string | null>(null)
  const [alertModalOpen, setAlertModalOpen] = useState(false)
  const [alertDetail, setAlertDetail] = useState<Alert | null>(null)
  const [alertTargets, setAlertTargets] = useState<unknown[]>([])
  const [alertDeliveries, setAlertDeliveries] = useState<unknown[]>([])
  const [commandHistory, setCommandHistory] = useState<import('./api').HydroReading[]>([])
  const [commandHistoryLoading, setCommandHistoryLoading] = useState(false)
  const [commandHistoryError, setCommandHistoryError] = useState('')
  // Per-station auto-stream snapshots (keyed by station_code). The 10s tick
  // advances EVERY station on the backend; each river page renders from its
  // own snapshot, so both basins stay live no matter which one is on screen.
  const [streamSnapshot, setStreamSnapshot] = useState<Record<string, ReplayTickStation>>({})
  const [dataRefreshToken, setDataRefreshToken] = useState(0)
  const [dashboardVersion, setDashboardVersion] = useState(0)
  // Manual relay trigger: opens a village picker, then calls the relay-alert
  // endpoint. That endpoint lands in the next phase, so the panel reports the
  // pending state honestly instead of pretending a message was relayed.
  const [relayPickerOpen, setRelayPickerOpen] = useState(false)
  const [relayTriggerState, setRelayTriggerState] = useState<{ tone: 'pending' | 'sent' | 'error'; text: string } | null>(null)
  const [relaySending, setRelaySending] = useState(false)
  const dashboardRefreshInFlight = useRef(false)
  // Basin reference data is stable; caching it lets the station card and map
  // switch immediately without waiting for a second round trip.
  const villageCacheRef = useRef<Record<RiverCode, Village[]>>({} as Record<RiverCode, Village[]>)

  // Full-screen loading is reserved for the first application load. Basin
  // switches reuse the already-loaded dashboard station data and swap the
  // village list in the background, so the control room never blanks out.
  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      setError('')
      try {
        const summary = await getDashboardSummary()
        if (cancelled) return
        setDashboard(summary)
        setDashboardVersion((value) => value + 1)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDashboard()
    return () => { cancelled = true }
  }, [])

  // Villages are small, stable reference data. Cache each basin and render
  // its cached list immediately on switch; refresh the selected basin quietly
  // in the background without setting the global loading flag.
  useEffect(() => {
    let cancelled = false
    let inFlight = false

    async function loadVillages() {
      if (inFlight) return
      const cached = villageCacheRef.current[riverCode]
      if (cached) {
        setVillages(cached)
        setSelectedVillageId(null)
      } else {
        setVillages([])
      }
      inFlight = true
      try {
        const response = await getVillages(riverCode)
        if (cancelled) return
        const items = response.items ?? []
        villageCacheRef.current[riverCode] = items
        setVillages(items)
        setSelectedVillageId(null)
      } catch (loadError) {
        if (!cancelled) {
          const cached = villageCacheRef.current[riverCode]
          if (cached) {
            setVillages(cached)
            setError('')
          } else {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load villages for this basin')
          }
        }
      } finally {
        inFlight = false
      }
    }

    void loadVillages()
    return () => { cancelled = true }
  }, [riverCode])

  // Global dashboard refresh: the current station/evaluation/alerts update
  // every five seconds even while the user changes basins.
  useEffect(() => {
    let cancelled = false

    async function refreshDashboard() {
      if (dashboardRefreshInFlight.current || document.visibilityState !== 'visible') return
      dashboardRefreshInFlight.current = true
      try {
        const summary = await getDashboardSummary()
        if (cancelled) return
        setDashboard(summary)
        setDashboardVersion((value) => value + 1)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to refresh dashboard data')
      } finally {
        dashboardRefreshInFlight.current = false
      }
    }

    const refreshTimer = window.setInterval(() => {
      if (!cancelled) void refreshDashboard()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(refreshTimer)
    }
  }, [])

  const stationSnapshot = useMemo(() => {
    if (!dashboard) return null
    return dashboard.stations.find((entry) => {
      const code = entry.station.station_code.toUpperCase()
      return riverCode === 'TEESTA' ? code === 'CWC_MELLI' : code === 'CWC_NANGLAMORAGHAT'
    }) ?? null
  }, [dashboard, riverCode])

  const latestEvaluation = useMemo(() => {
    const readingId = stationSnapshot?.latest_reading?.id
    if (!readingId || !dashboard) return null
    return dashboard.recent_evaluations
      .filter((item) => item.hydro_reading_id === readingId)
      .sort((a, b) => {
        const timeDifference = new Date(b.evaluated_at).getTime() - new Date(a.evaluated_at).getTime()
        return timeDifference || b.total_score - a.total_score
      })[0] ?? null
  }, [dashboard, stationSnapshot])

  const activeAlert = useMemo<Alert | null>(() => {
    if (!dashboard?.active_alerts.length) return null
    const matchingEvent = latestEvaluation?.event_id
      ? dashboard.active_alerts.find((alert) => alert.event_id === latestEvaluation.event_id)
      : null
    if (matchingEvent) return matchingEvent

    const stationName = stationSnapshot?.station.station_name?.toLowerCase() ?? ''
    const riverName = stationSnapshot?.station.river_name?.toLowerCase() ?? ''
    return dashboard.active_alerts.find((alert) => {
      const haystack = `${alert.title ?? ''} ${alert.description ?? ''}`.toLowerCase()
      return (stationName && haystack.includes(stationName)) || (riverName && haystack.includes(riverName))
    }) ?? null
  }, [dashboard, latestEvaluation, stationSnapshot])

  useEffect(() => {
    if (!activeAlert?.id) {
      setImpactAssessments([])
      return
    }

    const alertId = activeAlert.id
    let cancelled = false
    const hasExistingImpact = impactAssessments.length > 0
    setImpactLoading(!hasExistingImpact)
    setImpactError('')

    async function loadImpact() {
      try {
        const response = await getAlertImpact(alertId)
        if (cancelled) return
        setImpactAssessments(response.items ?? [])
      } catch (impactLoadError) {
        if (cancelled) return
        if (!hasExistingImpact) setImpactAssessments([])
        setImpactError(impactLoadError instanceof Error ? impactLoadError.message : 'Unable to load impact assessment')
      } finally {
        if (!cancelled) setImpactLoading(false)
      }
    }

    void loadImpact()
    return () => { cancelled = true }
  }, [activeAlert?.id])

  useEffect(() => {
    if (!villages.length) {
      setZones([])
      return
    }
    setZones((current) => {
      const next = projectVillages(villages, impactAssessments, latestEvaluation?.risk_level ?? 'watch')
      if (!current.length) return next
      return mergeImpact(next.map((zone) => {
        const existing = current.find((item) => item.id === zone.id)
        return existing ? { ...zone, coverage: existing.coverage, status: existing.status } : zone
      }), impactAssessments)
    })
  }, [villages, impactAssessments, latestEvaluation?.risk_level])

  const station = stationSnapshot?.station
  const reading = stationSnapshot?.latest_reading
  const priority = activeAlert?.priority ?? latestEvaluation?.alert_priority ?? 'P3'
  const alertTitle = activeAlert?.title ?? (latestEvaluation?.alert_recommended ? 'Alert recommended — pending approval' : 'No active public alert')
  const backendAlertStatus = activeAlert?.status?.replaceAll('_', ' ') ?? (latestEvaluation?.alert_recommended ? 'pending approval' : 'standby')
  const alertStatus = backendAlertStatus
  const hasAlert = Boolean(activeAlert || latestEvaluation?.alert_recommended)

  const totalPopulationAtRisk = impactAssessments.length
    ? impactAssessments.reduce((sum, item) => sum + (item.population_at_risk ?? 0), 0)
    : zones.reduce((sum, zone) => sum + zone.population, 0)

  const nearestImpact = impactAssessments.length
    ? [...impactAssessments].sort((a, b) => a.time_to_impact_minutes - b.time_to_impact_minutes)[0]
    : null

  // Streamed outputs: the active river's tick snapshot carries a fresh
  // rule-engine evaluation plus a dynamic impact preview, so scores/ETA
  // update every 10s tick for whichever river is on screen (and the other
  // river keeps streaming in the background).
  const streamEntry = streamSnapshot[station?.station_code ?? ''] ?? null
  const displayEvaluation = streamEntry?.evaluation ?? latestEvaluation
  const displayImpactAssessments = streamEntry?.impact_assessments?.length
    ? streamEntry.impact_assessments
    : impactAssessments
  const displayZones = useMemo(
    () => (streamEntry?.impact_assessments?.length ? mergeImpact(zones, streamEntry.impact_assessments) : zones),
    [streamEntry, zones],
  )
  const displayNearestImpact = useMemo(
    () => (displayImpactAssessments.length
      ? [...displayImpactAssessments].sort((a, b) => a.time_to_impact_minutes - b.time_to_impact_minutes)[0]
      : null),
    [displayImpactAssessments],
  )
  const displayPopulationAtRisk = displayImpactAssessments.length
    ? displayImpactAssessments.reduce((sum, item) => sum + (item.population_at_risk ?? 0), 0)
    : totalPopulationAtRisk

  const totalCoverage = zones.length
    ? Math.round(zones.reduce((sum, zone) => sum + zone.coverage, 0) / zones.length)
    : 0

  const highestRiskGap = useMemo(() => {
    if (!zones.length) return null
    return [...zones].sort((a, b) => {
      if (a.coverage !== b.coverage) return a.coverage - b.coverage
      return (a.eta ?? Number.MAX_SAFE_INTEGER) - (b.eta ?? Number.MAX_SAFE_INTEGER)
    })[0]
  }, [zones])

  const selectedVillage = useMemo(() => {
    if (!selectedVillageId) return null
    return displayZones.find((zone) => zone.id === selectedVillageId) ?? null
  }, [selectedVillageId, displayZones])

  const routeText = networks.internet
    ? 'Cloud → tower → village'
    : networks.cellular
      ? 'Cellular → tower → village'
      : networks.mesh
        ? 'Gateway → relay → village'
        : 'No active route'

  const routePath = useMemo(() => buildRoutePath(zones), [zones])
  const dataMode = String(reading?.data_mode ?? 'historical').toLowerCase()
  const dataModeLabel = dataMode === 'replay' ? 'HISTORICAL DATA REPLAY' : dataMode === 'live' ? 'LIVE DATA' : 'HISTORICAL DATA'

  useEffect(() => {
    setCommandHistoryError('')

    if (!station?.station_code) {
      setCommandHistory([])
      return
    }

    let cancelled = false
    setCommandHistoryLoading(true)

    void getHydroReadings(station.station_code, 50)
      .then((response) => {
        if (!cancelled) setCommandHistory(response.items ?? [])
      })
      .catch((loadError) => {
        if (!cancelled) {
          setCommandHistory([])
          setCommandHistoryError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load historical station data',
          )
        }
      })
      .finally(() => {
                if (!cancelled) setCommandHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [station?.station_code])

  const commandChronologicalHistory = useMemo(
    () => [...commandHistory].sort(
      (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
    ),
    [commandHistory],
  )

  // Always-on backend stream: every 10s one tick advances EVERY station
  // (both basins) to its next chronological historical reading and evaluates
  // it through the same rule engine as live ingestion. The cursor lives in
  // the DB (each station's latest rule evaluation), so no local locks are
  // needed, row counts never have to match between stations, and the stream
  // wraps back to the top of the dataset on its own after the newest row.
  useEffect(() => {
    let cancelled = false
    let inFlight = false

    async function runStreamTick() {
      if (cancelled || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const response = await replayTick()
        if (cancelled) return
        setStreamSnapshot((current) => {
          const next = { ...current }
          for (const entry of response.stations ?? []) {
            if (entry.error) continue
            next[entry.station_code] = entry
          }
          return next
        })
      } catch (streamError) {
        if (!cancelled) {
          setCommandHistoryError(streamError instanceof Error ? streamError.message : 'Auto stream tick failed')
        }
      } finally {
        inFlight = false
      }
    }

    // Start after the first interval rather than immediately, so the first
    // paint and basin interaction are not competing with a full two-station
    // evaluation pass.
    const timer = window.setInterval(() => { void runStreamTick() }, 10000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const commandDisplayReading = streamEntry?.reading ?? reading

  const commandReplayBand = useMemo(() => {
    const level = typeof commandDisplayReading?.water_level_m === 'number'
      ? commandDisplayReading.water_level_m
      : null
    const warning = typeof station?.warning_level_m === 'number'
      ? station.warning_level_m
      : null
    const danger = typeof station?.danger_level_m === 'number'
      ? station.danger_level_m
      : null
    const hfl = typeof station?.highest_flood_level_m === 'number'
      ? station.highest_flood_level_m
      : null

    if (level == null || warning == null) return 'MONITORING'
    if (level < warning) return 'NORMAL'
    if (danger != null && level < danger) return 'WATCH'
    if (hfl != null && level < hfl) return 'WARNING'
    return 'CRITICAL'
  }, [commandDisplayReading?.water_level_m, station?.warning_level_m, station?.danger_level_m, station?.highest_flood_level_m])

  const commandDisplayedMode = streamEntry
    ? 'AUTO STREAM · HISTORICAL DATASET'
    : dataModeLabel

  const commandDisplayedRisk = streamEntry?.risk_level
    ? riskLabel(streamEntry.risk_level)
    : riskLabel(latestEvaluation?.risk_level)

  const commandDisplayedThresholdGap = typeof commandDisplayReading?.water_level_m === 'number' && typeof station?.danger_level_m === 'number'
    ? station.danger_level_m - commandDisplayReading.water_level_m
    : null

  function resetScenario() {
    setStarted(false)
    setNetworks({ internet: true, cellular: true, mesh: false })
    setZones((current) => current.map((zone) => ({ ...zone, coverage: 0, status: 'unreached' })))
    setTick(0)
    setSelectedVillageId(null)
  }

  function simulateFailure() {
    setNetworks({ internet: false, cellular: false, mesh: true })
    setStarted(true)
    setZones((current) => current.map((zone, index) => ({
      ...zone,
      coverage: index === 0 ? 35 : Math.max(0, zone.coverage - 4),
      status: index === 0 ? 'relaying' : 'at risk',
    })))
  }

  function advanceMesh() {
    setNetworks((current) => ({ ...current, mesh: true }))
    setStarted(true)
    setTick((value) => value + 1)
    setZones((current) => current.map((zone, index) => {
      const increment = index === 0 ? 21 : index === 1 ? 16 : 10
      const nextCoverage = Math.min(100, zone.coverage + increment)
      return {
        ...zone,
        coverage: nextCoverage,
        status: nextCoverage >= 80 ? 'reached' : nextCoverage > 0 ? 'relaying' : 'unreached',
      }
    }))
  }

  function toggleNetwork(key: NetworkKey) {
    setNetworks((current) => ({ ...current, [key]: !current[key] }))
  }

  async function openAlertReview() {
    if (!activeAlert?.id) return
    try {
      const details = await getAlert(activeAlert.id)
      setAlertDetail(details.alert)
      setAlertTargets(details.targets)
      setAlertDeliveries(details.deliveries)
      setAlertModalOpen(true)
    } catch (loadError) {
      setImpactError(loadError instanceof Error ? loadError.message : 'Unable to load alert details')
    }
  }

  function openRelayPicker() {
    setRelayPickerOpen(true)
    setRelayTriggerState(null)
  }

  function closeRelayPicker() {
    if (relaySending) return
    setRelayPickerOpen(false)
  }

  // Manual relay trigger. The relay/hop code on the Android app is untouched —
  // this only calls the backend seam that will be implemented in the next phase.
  // Until that endpoint exists the request fails and we report it honestly.
  async function triggerRelay(villageId: string) {
    if (relaySending) return
    const village = zones.find((zone) => zone.id === villageId)
    if (!village) return

    setRelaySending(true)
    setRelayTriggerState({ tone: 'pending', text: `Relaying ${village.name}…` })
    try {
      const result = await sendRelayAlert(village.id, village.riskScore ?? 0)
      setRelayTriggerState({ tone: 'sent', text: `Relayed to ${village.name} · ${result.priority} · ${result.hops} hop(s)` })
      setRelayPickerOpen(false)
    } catch (triggerError) {
      setRelayTriggerState({
        tone: 'error',
        text: triggerError instanceof Error ? triggerError.message : 'Relay trigger failed',
      })
    } finally {
      setRelaySending(false)
    }
  }

  async function sendPhoneNotification() {
    if (!('Notification' in window)) {
      setNotificationState('blocked')
      return
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission !== 'granted') {
      setNotificationState('blocked')
      return
    }
    const villageName = highestRiskGap?.name ?? 'downstream villages'
    const eta = nearestImpact ? formatEta(nearestImpact.time_to_impact_minutes) : 'immediate'
    new Notification(`${priority} flood warning / ${PRODUCT_NAME}`, {
      body: `${villageName}: estimated impact ${eta}. Move toward the designated safe area if directed.`,
      icon: '/lastmile-icon.svg',
      tag: 'sentinel-x-p0',
    })
    setNotificationState('sent')
  }

  function locateRiskGap() {
    if (!highestRiskGap) return
    setSelectedVillageId(highestRiskGap.id)
    document.getElementById('village-impact-list')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const roleLabel: Record<RoleKey, string> = {
    control_room: 'Control Room',
    disaster_authority: 'Disaster Authority',
    village_authority: 'Village Authority',
    community_manager: 'Community Manager',
    community_member: 'Community Member',
    admin: 'System Admin',
  }

  function handleRoleChange(nextRole: RoleKey) {
    setSelectedRole(nextRole)
    setActiveTab('Command view')
    setMenuOpen(false)
  }

  if (loading) {
    return <div className="app-shell"><main className="content"><div className="panel loading-card"><span className="pulse-dot" /> Connecting to {PRODUCT_NAME} command services…</div></main></div>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Route size={18} /></div>
          <span>{PRODUCT_NAME}</span>
          <small>/ {PRODUCT_DESCRIPTOR}</small>
        </div>
        {selectedRole === 'control_room' ? (
          <nav className="control-nav" aria-label="Control Room workspace">
            {['Command view', 'Inbound data', 'Village delivery', 'Connectivity'].map((item) => (
              <button className={activeTab === item ? 'nav-link active' : 'nav-link'} key={item} onClick={() => setActiveTab(item)}>{item}</button>
            ))}
          </nav>
        ) : <div className="role-header-spacer" />}
        <div className="top-actions">
          <span className="live-pill"><span className="pulse-dot" /> BACKEND CONNECTED</span>
          {selectedRole === 'disaster_authority' && (
            <label className="role-switcher">
              <span>ACTIVE BASIN</span>
              <select
                value={riverCode}
                onChange={(event) => {
                  setRiverCode(event.target.value as RiverCode)
                  setTick(0)
                  setStarted(false)
                }}
                aria-label="Select active basin for Disaster Authority"
              >
                <option value="TEESTA">Teesta / Melli</option>
                <option value="DESANG">Desang / Nanglamoraghat</option>
              </select>
            </label>
          )}
          <button className="icon-btn mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={18} /></button>
          <label className="role-switcher">
            <span>DEMO ROLE</span>
            <select value={selectedRole} onChange={(event) => handleRoleChange(event.target.value as RoleKey)} aria-label="Select demo role">
              {(['control_room', 'disaster_authority', 'village_authority', 'community_manager', 'community_member'] as RoleKey[]).map((key) => <option key={key} value={key}>{roleLabel[key]}</option>)}
            </select>
          </label>
        </div>
      </header>

      {menuOpen && (
        <div className="mobile-nav">
          {selectedRole === 'control_room' && ['Command view', 'Inbound data', 'Village delivery', 'Connectivity'].map((item) => (
            <button key={item} className={activeTab === item ? 'selected' : ''} onClick={() => { setActiveTab(item); setMenuOpen(false) }}>{item}</button>
          ))}
          {selectedRole === 'disaster_authority' && (
            <div className="mobile-role-list">
              <span>ACTIVE BASIN</span>
              <button className={riverCode === 'TEESTA' ? 'selected' : ''} onClick={() => { setRiverCode('TEESTA'); setMenuOpen(false) }}>Teesta / Melli</button>
              <button className={riverCode === 'DESANG' ? 'selected' : ''} onClick={() => { setRiverCode('DESANG'); setMenuOpen(false) }}>Desang / Nanglamoraghat</button>
            </div>
          )}
          <div className="mobile-role-list">
            <span>DEMO ROLE</span>
            {(['control_room', 'disaster_authority', 'village_authority', 'community_manager', 'community_member'] as RoleKey[]).map((key) => <button className={selectedRole === key ? 'selected' : ''} key={key} onClick={() => handleRoleChange(key)}>{roleLabel[key]}</button>)}
          </div>
        </div>
      )}

      <main className="content">
        {selectedRole !== 'control_room' ? (
          <RoleWorkspace
            role={selectedRole}
            riverCode={riverCode}
            station={station}
            reading={reading}
            latestEvaluation={latestEvaluation}
            activeAlert={activeAlert}
            dashboard={dashboard}
            zones={zones}
            impactAssessments={impactAssessments}
            networks={networks}
            totalPopulationAtRisk={totalPopulationAtRisk}
            nearestImpact={nearestImpact}
            onSelectVillage={setSelectedVillageId}
            onReviewAlert={() => { void openAlertReview() }}
          />
        ) : (
        activeTab === 'Command view' ? <>
        <section className="command-v4-head">
          <div>
            <span className="command-v4-kicker">SENTINEL-X / CONTROL ROOM</span>
            <h1>River hazard command</h1>
            <p>One operational view of the station signal, rule-engine decision, downstream impact and human warning gate.</p>
          </div>
          <div className="command-v4-actions">
            <label>
              <span>ACTIVE BASIN</span>
              <select value={riverCode} onChange={(event) => setRiverCode(event.target.value as RiverCode)}>
                <option value="TEESTA">Teesta / Melli</option>
                <option value="DESANG">Desang / Nanglamoraghat</option>
              </select>
            </label>
            <button className="command-v4-btn secondary" onClick={resetScenario} title="Reset local dashboard state">
              <RefreshCw size={15} /> Reset
            </button>
          </div>
        </section>

        {error && <div className="command-v4-error"><AlertTriangle size={16} /> <span>Backend error: {error}</span></div>}

        <section className="command-v4-context panel">
          <div>
            <span className="command-v4-kicker">{commandDisplayedMode}</span>
            <b>{station?.station_name ?? 'Monitoring station'}</b>
            <small>{station?.river_name ?? riverCode} · {station?.district ?? 'District unavailable'}</small>
          </div>
          <div className="command-v4-replay">
            <div>
              <TimerReset size={16} />
              <span>{streamEntry ? `AUTO STREAM · step ${streamEntry.step_index} / ${streamEntry.total_steps} · every 10s` : 'AUTO STREAM · connecting…'}</span>
            </div>
          </div>
        </section>

        <section className="command-v4-stations">
          {(dashboard?.stations ?? []).map((entry) => {
            const active = entry.station.station_code === station?.station_code
            const shownReading = streamSnapshot[entry.station.station_code]?.reading ?? entry.latest_reading
            const entryStream = streamSnapshot[entry.station.station_code] ?? null
            const dotBand = active
              ? commandReplayBand.toLowerCase()
              : entryStream?.risk_level ? riskLabel(entryStream.risk_level).toLowerCase() : ''
            return (
              <button
                key={entry.station.id}
                className={`command-v4-station ${active ? 'active' : ''}`}
                onClick={() => setRiverCode(entry.station.station_code === 'CWC_MELLI' ? 'TEESTA' : 'DESANG')}
              >
                <span className="command-v4-station-icon"><Waves size={16} /></span>
                <span className="command-v4-station-copy">
                  <small>{entry.station.river_name ?? 'River'}</small>
                  <b>{entry.station.station_name}</b>
                  <span>{shownReading?.water_level_m != null ? `${Number(shownReading.water_level_m).toFixed(2)} m` : 'No reading'} · {formatTime(shownReading?.observed_at)}</span>
                </span>
                <span className={`command-v4-state-dot ${dotBand}`} />
              </button>
            )
          })}
        </section>

        <section className="command-v4-metrics">
          <div className="command-v4-metric accent-coral">
            <span>WATER LEVEL</span>
            <strong>{commandDisplayReading?.water_level_m != null ? `${Number(commandDisplayReading.water_level_m).toFixed(2)} m` : '—'}</strong>
            <small>{streamEntry ? 'auto-streamed observation' : 'latest station observation'}</small>
          </div>
          <div className="command-v4-metric accent-yellow">
            <span>BACKEND RISK</span>
            <strong>{displayEvaluation?.total_score != null ? `${displayEvaluation.total_score.toFixed(0)}/100` : '—'}</strong>
            <small>{riskLabel(displayEvaluation?.risk_level)} · {displayEvaluation?.alert_recommended ? 'alert recommended' : 'monitoring'}</small>
          </div>
          <div className="command-v4-metric accent-lime">
            <span>TIME TO IMPACT</span>
            <strong>{displayNearestImpact ? formatEta(displayNearestImpact.time_to_impact_minutes) : '—'}</strong>
            <small>{displayNearestImpact ? displayZones.find((z) => z.id === displayNearestImpact.village_id)?.name ?? 'nearest assessed village' : 'impact assessment pending'}</small>
          </div>
          <div className="command-v4-metric accent-cyan">
            <span>POPULATION AT RISK</span>
            <strong>{formatNumber(displayPopulationAtRisk)}</strong>
            <small>{displayImpactAssessments.length} assessed villages</small>
          </div>
        </section>

        <section className="command-v4-grid">
          <article className="command-v4-hazard panel">
            <div className="command-v4-panel-head">
              <div><span className="command-v4-kicker">01 / HAZARD STATE</span><h2>{station?.river_name ?? riverCode} / {station?.station_name ?? 'Station'}</h2></div>
              <span className={`command-v4-risk ${commandDisplayedRisk.toLowerCase()}`}>
                {commandDisplayedRisk}
              </span>
            </div>

            <div className="command-v4-current-row">
              <div className="command-v4-current">
                <span>CURRENT WATER LEVEL</span>
                <strong>{commandDisplayReading?.water_level_m != null ? `${Number(commandDisplayReading.water_level_m).toFixed(2)} m` : '—'}</strong>
                <small>{formatTime(commandDisplayReading?.observed_at)} · {streamEntry ? `stream step ${streamEntry.step_index}/${streamEntry.total_steps}` : 'backend latest reading'}</small>
              </div>
              <div className="command-v4-impact-callout">
                <Clock3 size={17} />
                <div><span>NEAREST IMPACT</span><strong>{displayNearestImpact ? formatEta(displayNearestImpact.time_to_impact_minutes) : '—'}</strong><small>{displayNearestImpact ? displayZones.find((z) => z.id === displayNearestImpact.village_id)?.name ?? 'assessed village' : 'Assessment pending'}</small></div>
              </div>
            </div>

            <div className="command-v4-thresholds">
              <ThresholdCard label="Current" value={commandDisplayReading?.water_level_m != null ? `${Number(commandDisplayReading.water_level_m).toFixed(2)} m` : '—'} tone="current" />
              <ThresholdCard label="Warning" value={station?.warning_level_m != null ? `${Number(station.warning_level_m).toFixed(2)} m` : '—'} tone="warning" />
              <ThresholdCard label="Danger" value={station?.danger_level_m != null ? `${Number(station.danger_level_m).toFixed(2)} m` : '—'} tone="danger" />
              <ThresholdCard label="HFL" value={station?.highest_flood_level_m != null ? `${Number(station.highest_flood_level_m).toFixed(2)} m` : '—'} tone="hfl" />
            </div>

            <div className="command-v4-secondary-metrics">
              <div><span>Rise rate</span><b>{commandDisplayReading?.water_level_rate_m_hr != null ? `${Number(commandDisplayReading.water_level_rate_m_hr).toFixed(2)} m/hr` : '—'}</b></div>
              <div><span>Danger margin</span><b>{commandDisplayedThresholdGap != null ? `${Math.abs(commandDisplayedThresholdGap).toFixed(2)} m ${commandDisplayedThresholdGap >= 0 ? 'below' : 'above'}` : '—'}</b></div>
              <div><span>Observed</span><b>{formatTime(commandDisplayReading?.observed_at)}</b></div>
              <div><span>Freshness</span><b>{commandDisplayReading?.observed_at ? 'Timestamped' : 'Unavailable'}</b></div>
            </div>
          </article>

          <article className="command-v4-alert panel">
            <div className="command-v4-panel-head">
              <div><span className="command-v4-kicker">02 / ALERT CONTROL</span><h2>Human approval gate</h2></div>
              <span className={`command-v4-status ${activeAlert ? 'attention' : 'quiet'}`}>{alertStatus.toUpperCase()}</span>
            </div>
            <div className="command-v4-alert-summary">
              <div className="command-v4-alert-icon"><AlertTriangle size={20} /></div>
              <div><h3>{alertTitle}</h3><p>{activeAlert?.description ?? displayEvaluation?.reasons?.[0] ?? 'The rule engine is monitoring station thresholds and supporting evidence.'}</p></div>
            </div>
            <div className="command-v4-alert-facts">
              <div><span>Priority</span><b>{priority}</b></div>
              <div><span>Risk score</span><b>{displayEvaluation?.total_score != null ? `${displayEvaluation.total_score.toFixed(1)}/100` : '—'}</b></div>
              <div><span>Generated</span><b>{formatTime(activeAlert?.created_at ?? displayEvaluation?.evaluated_at)}</b></div>
            </div>
            {activeAlert ? (
              <button className="command-v4-review" onClick={openAlertReview}><ShieldCheck size={16} /> Review alert & impact <ArrowRight size={15} /></button>
            ) : (
              <div className="command-v4-note"><ShieldCheck size={15} /><span>{displayEvaluation?.alert_recommended ? 'Alert recommended. Authenticated Control Room approval is required before dispatch.' : 'Monitoring only. No public warning is currently recommended.'}</span></div>
            )}
            <div className="command-v4-warning-note"><ShieldCheck size={14} /><span>Only the authorized Control Room workflow can approve a public warning. Replay does not change alert state.</span></div>
          </article>
        </section>

        <section className="command-v4-grid lower">
          <article className="command-v4-map panel">
            <div className="command-v4-panel-head">
              <div><span className="command-v4-kicker">03 / IMPACT MAP</span><h2>Station → downstream villages</h2></div>
              <span className="command-v4-map-help"><MapPin size={14} /> Click a village</span>
            </div>
            <div className="command-v4-map-canvas">
              <div className="command-v4-map-grid" />
              <div className="command-v4-map-water" />
              <svg className="command-v4-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {displayZones.length > 1 && <polyline points={buildZonePolyline(displayZones)} />}
              </svg>
              <div className="command-v4-map-station" style={{ left: '16%', top: '23%' }}>
                <span className="pulse" />
                <span className="core"><CloudRain size={14} /></span>
                <b>{station?.station_name ?? 'Station'}</b>
                <small>{commandDisplayReading?.water_level_m != null ? `${Number(commandDisplayReading.water_level_m).toFixed(2)} m` : '—'}</small>
              </div>
              {displayZones.map((zone) => (
                <button key={zone.id} className={`command-v4-village-marker ${zone.id === selectedVillageId ? 'selected' : ''}`} style={{ left: `${zone.x}%`, top: `${zone.y}%` }} onClick={() => setSelectedVillageId(zone.id)} title={`${zone.name} · ${zone.risk}`}>
                  <span className={`dot ${zone.risk.toLowerCase()}`} />
                  <span><b>{zone.name}</b><small>{zone.riskScore != null ? `${zone.risk} · ${zone.riskScore}/100` : 'No current impact assessment'}</small></span>
                </button>
              ))}
              <div className="command-v4-map-legend"><span><i className="station" /> Station</span><span><i className="village" /> Village</span><span><i className="route" /> Impact path</span></div>
            </div>
          </article>

          <article className="command-v4-evidence panel">
            <div className="command-v4-panel-head">
              <div><span className="command-v4-kicker">04 / RULE ENGINE</span><h2>Current backend decision</h2></div>
              <div className="command-v4-score">{displayEvaluation?.total_score != null ? displayEvaluation.total_score.toFixed(0) : '—'}<small>/100</small></div>
            </div>
            <div className="command-v4-factors">
              <Factor label="Water level" value={displayEvaluation?.level_score} max={60} />
              <Factor label="Rise rate" value={displayEvaluation?.rate_score} max={20} />
              <Factor label="Sensor" value={displayEvaluation?.sensor_score} max={10} />
              <Factor label="Community" value={displayEvaluation?.community_score} max={5} />
              <Factor label="Persistence" value={displayEvaluation?.persistence_score} max={5} />
            </div>
            <div className="command-v4-reasons">
              <span>ENGINE REASONS</span>
              {displayEvaluation?.reasons?.length ? displayEvaluation.reasons.map((reason) => <div key={reason}><CheckCircle2 size={14} />{reason}</div>) : <div><Info size={14} /> No detailed reason returned.</div>}
            </div>
            <div className="command-v4-evidence-foot"><Database size={14} /> Engine {displayEvaluation?.engine_version ?? 'v1.0'} · evaluated {formatTime(displayEvaluation?.evaluated_at)}</div>
          </article>
        </section>

        <section className="command-v4-data panel">
          <div className="command-v4-panel-head">
            <div><span className="command-v4-kicker">05 / IMPACT ASSESSMENT</span><h2>Affected villages & time to impact</h2></div>
            <div className="command-v4-impact-actions">
              <div className="command-v4-head-total"><b>{displayImpactAssessments.length}</b><span>assessed</span><b>{formatNumber(displayPopulationAtRisk)}</b><span>people at risk</span></div>
              <button className="command-v4-btn primary relay-trigger-btn" onClick={openRelayPicker} disabled={!displayImpactAssessments.length}>
                <Radio size={14} /> Relay alert
              </button>
            </div>
          </div>
          {relayTriggerState && (
            <div className={`command-v4-relay-status ${relayTriggerState.tone}`} role="status">
              {relayTriggerState.tone === 'sent' ? <CheckCircle2 size={15} /> : relayTriggerState.tone === 'error' ? <AlertTriangle size={15} /> : <Activity size={15} />}
              <span>{relayTriggerState.text}</span>
            </div>
          )}
          {impactLoading ? (
            <div className="command-v4-empty"><Activity size={16} /> Loading backend impact assessment…</div>
          ) : impactError ? (
            <div className="command-v4-empty error"><AlertTriangle size={16} /> {impactError}</div>
          ) : displayImpactAssessments.length ? (
            <div className="command-v4-impact-table">
              <div className="command-v4-impact-head"><span>Village</span><span>Risk</span><span>ETA</span><span>Population</span><span>Downstream</span><span>Delivery</span></div>
              {displayZones
                .filter((zone) => displayImpactAssessments.some((impact) => impact.village_id === zone.id))
                .map((zone) => {
                  const impact = displayImpactAssessments.find((item) => item.village_id === zone.id)
                  const zoneRisk = impact?.risk_level ?? zone.risk
                  const zoneRiskScore = impact?.risk_score ?? zone.riskScore
                  const zoneEta = impact?.time_to_impact_minutes ?? zone.eta
                  return (
                    <button key={zone.id} className={`command-v4-impact-row ${selectedVillageId === zone.id ? 'selected' : ''}`} onClick={() => setSelectedVillageId(zone.id)}>
                      <span className="village-main"><b>{zone.name}</b><small>{zone.status}</small></span>
                      <span><strong className={`command-v4-risk-text ${zoneRisk.toLowerCase()}`}>{riskLabel(zoneRisk)}</strong><small>{zoneRiskScore ?? '—'}/100</small></span>
                      <strong>{formatEta(zoneEta)}</strong>
                      <strong>{formatNumber(zone.population)}</strong>
                      <strong>#{impact?.downstream_order ?? zone.downstreamOrder ?? '—'}</strong>
                      <span><em className="command-v4-assessed">ASSESSED</em><small>Impact engine</small></span>
                    </button>
                  )
                })}
            </div>
          ) : (
            <div className="command-v4-empty"><Info size={16} /> No persisted impact assessment is available for the current alert.</div>
          )}
          <div className="command-v4-disclaimer"><Info size={14} /> Impact risk and ETA are backend assessments. The current prototype uses the seeded downstream-order model.</div>
        </section>

        <section className="command-v4-history panel">
          <div className="command-v4-panel-head">
            <div><span className="command-v4-kicker">06 / HISTORICAL DATA</span><h2>Station observation sequence</h2></div>
            <span>{commandChronologicalHistory.length} stored observations</span>
          </div>
          {commandHistoryLoading ? (
            <div className="command-v4-empty"><Activity size={16} /> Loading historical readings…</div>
          ) : commandHistoryError ? (
            <div className="command-v4-empty error"><AlertTriangle size={16} /> {commandHistoryError}</div>
          ) : (
            <div className="command-v4-history-list">
              {commandChronologicalHistory.map((item, index) => {
                const streamedIndex = streamEntry ? streamEntry.step_index - 1 : null
                return (
                  <div key={item.id} className={`command-v4-history-row ${streamedIndex === index ? 'active' : ''}`}>
                    <span>{streamedIndex === index ? 'STREAM' : index === commandChronologicalHistory.length - 1 ? 'LATEST' : `STEP ${index + 1}`}</span>
                    <b>{item.water_level_m != null ? `${Number(item.water_level_m).toFixed(2)} m` : '—'}</b>
                    <span>{item.water_level_rate_m_hr != null ? `${Number(item.water_level_rate_m_hr).toFixed(2)} m/hr` : '—'}</span>
                    <small>{dateTime(item.observed_at)}</small>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {selectedVillage && (
          <section className="command-v4-selected panel">
            <div><span className="command-v4-kicker">SELECTED VILLAGE</span><h2>{selectedVillage.name}</h2><p>{selectedVillage.risk} · population {formatNumber(selectedVillage.population)} · vulnerability {selectedVillage.vulnerability ?? '—'}</p></div>
            <div><b>{selectedVillage.riskScore ?? '—'}</b><span>risk score</span></div>
            <div><b>{formatEta(selectedVillage.eta)}</b><span>time to impact</span></div>
            <div><b>{selectedVillage.downstreamOrder ? `#${selectedVillage.downstreamOrder}` : '—'}</b><span>downstream</span></div>
            <button className="command-v4-btn secondary" onClick={() => setSelectedVillageId(null)}>Close</button>
          </section>
        )}

        </> : activeTab === 'Connectivity' ? <ConnectivityPage riverCode={riverCode} onRiverChange={(nextRiver) => { setRiverCode(nextRiver); setTick(0); setStarted(false) }} /> : activeTab === 'Inbound data' ? <InboundDataPage riverCode={riverCode} onRiverChange={(nextRiver) => setRiverCode(nextRiver)} onRefresh={() => setDataRefreshToken((value) => value + 1)} refreshToken={dataRefreshToken} /> : activeTab === 'Village delivery' ? <VillageDeliveryPage riverCode={riverCode} onRiverChange={(nextRiver) => setRiverCode(nextRiver)} onRefresh={() => setDataRefreshToken((value) => value + 1)} refreshToken={dataRefreshToken} /> : <ControlRoomPanel section={activeTab} station={station} reading={reading} latestEvaluation={latestEvaluation} activeAlert={activeAlert} dashboard={dashboard} zones={zones} networks={networks} totalPopulationAtRisk={totalPopulationAtRisk} onReviewAlert={() => { void openAlertReview() }} />
        )}
      </main>

      <footer>
        <span><span className="pulse-dot" /> Last sync {formatTime(displayEvaluation?.evaluated_at ?? reading?.observed_at)} IST</span>
        <span>{PRODUCT_NAME} <span className="footer-divider" /> {roleLabel[selectedRole]} workspace <span className="footer-divider" /> v0.2 / field test</span>
      </footer>

      {relayPickerOpen && (
        <div className="modal-backdrop" role="presentation" onClick={closeRelayPicker}>
          <section className="modal-card relay-picker-modal" role="dialog" aria-modal="true" aria-labelledby="relay-picker-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="section-kicker">RELAY DISPATCH / MANUAL OVERRIDE</span><h2 id="relay-picker-title">Relay alert to a village</h2></div>
              <button className="icon-btn" onClick={closeRelayPicker} disabled={relaySending} aria-label="Close relay picker"><X size={17} /></button>
            </div>

            <p className="relay-picker-intro">
              Automatic relay is reserved for villages whose risk score reaches the high-risk threshold.
              Use this only when automation could not reach a phone, or when an operator must force a retry.
            </p>

            <div className="relay-picker-auto-note">
              <ShieldCheck size={15} />
              <span>
                Auto-dispatch threshold: <b>70/100</b> ({'≥ 70 = HIGH'}). Villages currently below it are listed for manual override only.
              </span>
            </div>

            {relayTriggerState?.tone === 'error' && (
              <div className="relay-picker-error"><AlertTriangle size={15} /><span>{relayTriggerState.text}</span></div>
            )}

            <div className="relay-picker-list">
              {displayZones
                .filter((zone) => displayImpactAssessments.some((impact) => impact.village_id === zone.id))
                .map((zone) => {
                  const impact = displayImpactAssessments.find((item) => item.village_id === zone.id)
                  const score = impact?.risk_score ?? zone.riskScore ?? 0
                  const aboveThreshold = score >= 70
                  return (
                    <div key={zone.id} className={`relay-picker-row ${aboveThreshold ? 'auto-eligible' : ''}`}>
                      <div className="relay-picker-village">
                        <b>{zone.name}</b>
                        <small>{zone.status} · impact {formatEta(impact?.time_to_impact_minutes ?? zone.eta)}</small>
                      </div>
                      <div className="relay-picker-score">
                        <strong className={`command-v4-risk-text ${riskLabel(impact?.risk_level ?? zone.risk).toLowerCase()}`}>{riskLabel(impact?.risk_level ?? zone.risk)}</strong>
                        <small>{Math.round(score)}/100</small>
                      </div>
                      <span className={`relay-picker-tag ${aboveThreshold ? 'auto' : 'manual'}`}>{aboveThreshold ? 'AUTO-ELIGIBLE' : 'MANUAL ONLY'}</span>
                      <button className="command-v4-btn primary" onClick={() => void triggerRelay(zone.id)} disabled={relaySending}>
                        {relaySending ? <Activity size={13} /> : <Radio size={13} />}
                        Relay
                      </button>
                    </div>
                  )
                })}
            </div>

            <div className="approval-note"><ShieldCheck size={16} /><span>The Android relay and hop logic are unchanged. This screen only records the operator's intent; the backend relay endpoint is the next implementation phase.</span></div>
            <button className="primary-btn modal-close" onClick={closeRelayPicker} disabled={relaySending}><CheckCircle2 size={16} /> Close</button>
          </section>
        </div>
      )}

      {alertModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setAlertModalOpen(false)}>
          <section className="modal-card approval-modal" role="dialog" aria-modal="true" aria-labelledby="alert-review-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span className="section-kicker">ALERT REVIEW / HUMAN GATE</span><h2 id="alert-review-title">{alertDetail?.title ?? alertTitle}</h2></div>
              <button className="icon-btn" onClick={() => setAlertModalOpen(false)} aria-label="Close alert review"><X size={17} /></button>
            </div>

            <div className="modal-severity">
              <div className="alert-symbol"><AlertTriangle size={19} /></div>
              <div><b>{alertDetail?.priority ?? priority} / {alertDetail?.severity ?? 'Severe'}</b><span>Status: {alertStatus}</span></div>
            </div>
            <div className="approval-timeline">
              <div className="timeline-step complete"><span>01</span><b>Detected</b><small>Evidence evaluated</small></div>
              <div className="timeline-line active" />
              <div className="timeline-step complete"><span>02</span><b>Recommended</b><small>Rule engine threshold met</small></div>
              <div className="timeline-line active" />
              <div className="timeline-step current"><span>03</span><b>Approval</b><small>Authenticated human required</small></div>
              <div className="timeline-line" />
              <div className="timeline-step"><span>04</span><b>Dispatch</b><small>Blocked until authorization</small></div>
            </div>

            <div className="modal-copy">{alertDetail?.description ?? latestEvaluation?.reasons?.join(' · ') ?? 'No extended alert description available.'}</div>
            {alertDetail?.instruction && <div className="instruction-box"><Info size={16} /><span>{alertDetail.instruction}</span></div>}

            <div className="modal-grid">
              <div><small>Affected villages</small><b>{impactAssessments.length || alertTargets.length}</b></div>
              <div><small>Population at risk</small><b>{formatNumber(totalPopulationAtRisk)}</b></div>
              <div><small>Deliveries recorded</small><b>{alertDeliveries.length}</b></div>
              <div><small>Approval</small><b>Authenticated user required</b></div>
            </div>

            <div className="approval-action-panel">
              <div><b>Authorization is not enabled yet</b><span>This review package is available to the appropriate role, but Supabase Auth and the protected approval API are the next phase. No alert status is changed here.</span></div>
            </div>

            <div className="approval-note"><ShieldCheck size={16} /><span>Only an authenticated authorized role can approve a public warning. Community members and village users can receive/report; they do not authorize public dispatch.</span></div>
            <button className="primary-btn modal-close" onClick={() => setAlertModalOpen(false)}><CheckCircle2 size={16} /> Close review</button>
          </section>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, suffix, icon, accent }: { label: string; value: string; suffix: string; icon: ReactNode; accent: string }) {
  return <div className={'stat-card ' + accent}><div className="stat-icon">{icon}</div><span className="stat-label">{label}</span><strong>{value}</strong><small>{suffix}</small></div>
}

function NetworkRow({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return <button className="network-row" onClick={onClick}><div className="network-icon">{icon}</div><div className="network-name"><b>{label}</b><span>{active ? 'Operational' : 'Unavailable'}</span></div><div className={'network-state ' + (active ? 'on' : '')}>{active ? <Signal size={16} /> : <WifiOff size={16} />}</div><div className={'toggle ' + (active ? 'enabled' : '')}><span /></div></button>
}

function Relay({ rank, device, location, score, battery, direction }: { rank: string; device: string; location: string; score: string; battery: string; direction: string }) {
  return <div className="relay-row"><span className="relay-rank">{rank}</span><div className="phone-icon"><Smartphone size={16} /></div><div className="relay-name"><b>{device}</b><span>{location} / moving {direction}</span></div><div className="relay-score"><b>{score}</b><span>score</span></div><div className="battery"><BatteryMedium size={14} /> {battery}%</div></div>
}

function FlowItem({ title, detail }: { title: string; detail: string }) {
  return <div className="flow-item"><b>{title}</b><span>{detail}</span></div>
}

export default App
