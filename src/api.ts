const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
    ? '/api'
    : 'http://127.0.0.1:8000/api')

type ApiEnvelope<T> = T

export type River = {
  id: string
  basin_code: string
  basin_name: string
  river_system?: string | null
}

export type Station = {
  id: string
  station_code: string
  station_name: string
  river_name?: string | null
  district?: string | null
  state?: string | null
  latitude?: number | null
  longitude?: number | null
  warning_level_m?: number | null
  danger_level_m?: number | null
  highest_flood_level_m?: number | null
}

export type HydroReading = {
  id: string
  station_id: string
  observed_at: string
  water_level_m?: number | null
  water_level_rate_m_hr?: number | null
  data_mode?: string | null
}

export type Village = {
  id: string
  village_code: string
  village_name: string
  district?: string | null
  state?: string | null
  latitude?: number | null
  longitude?: number | null
  population?: number | null
  vulnerability_score?: number | null
  internet_available?: boolean | null
  cellular_available?: boolean | null
}

export type RuleEvaluation = {
  id: string
  hydro_reading_id?: string | null
  event_id?: string | null
  total_score: number
  level_score?: number | null
  rate_score?: number | null
  sensor_score?: number | null
  community_score?: number | null
  persistence_score?: number | null
  engine_version?: string | null
  risk_level: string
  alert_recommended: boolean
  alert_priority?: string | null
  reasons?: string[] | null
  evaluated_at: string
}

export type Alert = {
  id: string
  alert_code?: string | null
  title: string
  description?: string | null
  instruction?: string | null
  priority?: string | null
  urgency?: string | null
  severity?: string | null
  certainty?: string | null
  status: string
  created_at: string
  event_id?: string | null
}

export type ImpactAssessment = {
  event_id?: string | null
  village_id: string
  risk_score: number
  risk_level: string
  time_to_impact_minutes: number
  hazard_path_distance_km?: number | null
  downstream_order?: number | null
  population_at_risk?: number | null
  calculation_method?: string | null
  model_version?: string | null
}

export type DashboardSummary = {
  stations: Array<{
    station: Station
    latest_reading: HydroReading | null
  }>
  recent_evaluations: RuleEvaluation[]
  active_alerts: Alert[]
}


export type ConnectivityVillage = {
  village_id: string
  village_name: string
  village_code?: string | null
  population?: number | null
  internet_available?: boolean | null
  cellular_available?: boolean | null
  target_status: string
  selected_route?: string | null
  delivery_status: string
  delivery_count: number
  last_delivery_at?: string | null
  simulated: boolean
}

export type ConnectivitySummary = {
  river: { id: string; basin_code: string; basin_name: string }
  active_alert?: Alert | null
  summary: {
    villages: number
    active_alerts: number
    targeted_villages: number
    delivered_villages: number
    delivery_records: number
    delivered_records: number
    pending_records: number
    failed_records: number
    internet_configured_villages: number
    cellular_configured_villages: number
    last_delivery_at?: string | null
  }
  channels: Array<{
    channel: string
    records: number
    delivered: number
    pending: number
    failed: number
    simulated: number
    last_activity_at?: string | null
  }>
  villages: ConnectivityVillage[]
  offline_relay: { status: string; label: string; telemetry_connected: boolean }
  source_errors: Array<{ source?: string; message?: string }>
}

export type VillagesResponse = {
  river: River
  items: Village[]
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `API request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function getDashboardSummary() {
  return apiRequest<DashboardSummary>('/dashboard/summary')
}

export function getVillages(riverCode: string) {
  return apiRequest<VillagesResponse>(`/rivers/${encodeURIComponent(riverCode)}/villages`)
}

export function getStations(riverCode: string) {
  return apiRequest<{ river: River; items: Station[] }>(`/rivers/${encodeURIComponent(riverCode)}/stations`)
}

export function getHydroReadings(stationCode: string, limit = 500) {
  return apiRequest<{ station: Station; items: HydroReading[] }>(
    `/hydro/readings?station_code=${encodeURIComponent(stationCode)}&limit=${limit}`,
  )
}

export function getInboundSummary(riverCode: string, limit = 50) {
  return apiRequest<InboundSummary>(
    `/inbound/summary?river_code=${encodeURIComponent(riverCode)}&limit=${limit}`,
  )
}

export function getActiveAlerts() {
  return apiRequest<{ items: Alert[] }>('/alerts/active')
}

export function getAlert(alertId: string) {
  return apiRequest<{ alert: Alert; targets: unknown[]; deliveries: unknown[] }>(`/alerts/${alertId}`)
}

export function getAlertImpact(alertId: string) {
  return apiRequest<{ event_id: string | null; items: ImpactAssessment[] }>(`/alerts/${alertId}/impact`)
}

export function getConnectivitySummary(riverCode: string) {
  return apiRequest<ConnectivitySummary>(`/connectivity/summary?river_code=${encodeURIComponent(riverCode)}`)
}

export function startReplay(riverCode: string, payload: { station_code?: string; limit?: number; delay_seconds?: number }) {
  return apiRequest<unknown>(`/demo/replay/${encodeURIComponent(riverCode)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ReplayStepResponse = {
  river: { id: string; basin_code: string; basin_name: string; river_system?: string | null }
  station: Station
  reading: HydroReading
  evaluation: RuleEvaluation
  risk_level: string
  total_score: number
  alert_recommended: boolean
  alert_priority?: string | null
  reasons?: string[] | null
  alert: Alert | null
  evidence?: { sensor?: boolean | null; community?: boolean | null } | null
  impact_assessments: ImpactAssessment[]
  mode: string
}

export function replayReadingStep(riverCode: string, stationCode: string, readingId: string) {
  return apiRequest<ReplayStepResponse>(`/demo/replay/${encodeURIComponent(riverCode)}/step`, {
    method: 'POST',
    body: JSON.stringify({ station_code: stationCode, reading_id: readingId }),
  })
}

// One automatic streaming tick: the backend advances every station (both
// basins) to its next chronological historical reading, evaluates it through
// the rule engine and rebuilds the village impact. Cursor state lives in the
// DB, so this needs no local replay bookkeeping.
export type ReplayTickStation = {
  river_code: string
  river_name?: string | null
  station_code: string
  station_name: string
  reading: HydroReading
  evaluation: RuleEvaluation
  risk_level: string
  total_score: number
  alert_recommended: boolean
  alert_priority?: string | null
  reasons?: string[] | null
  alert: Alert | null
  impact_assessments: ImpactAssessment[]
  step_index: number
  total_steps: number
  error?: string | null
}

export type ReplayTickResponse = {
  tick_at: string | null
  stations: ReplayTickStation[]
  coalesced?: boolean
}

export function replayTick() {
  return apiRequest<ReplayTickResponse>('/demo/replay/tick', { method: 'POST' })
}

// ---------------------------------------------------------------------------
// Relay trigger seam.
//
// The backend endpoint (POST /api/android/relay-alert) is intentionally not
// implemented yet — it is the next phase. The Command View calls this so the
// UI is wired and ready; until the endpoint exists the request fails and the
// panel reports that honestly rather than faking a success.
//
// `source` is 'manual' here. The automatic path ('auto', fired by the stream
// tick when a village risk crosses the threshold) will reuse the same endpoint.
// ---------------------------------------------------------------------------
export type RelayTriggerResult = {
  alert_id: string
  village_id: string
  priority: string
  message: string
  hops: number
}

export function sendRelayAlert(villageId: string, riskScore: number) {
  return apiRequest<RelayTriggerResult>('/android/relay-alert', {
    method: 'POST',
    body: JSON.stringify({ village_id: villageId, source: 'manual', trigger_score: riskScore }),
  })
}



export type InboundHydroRecord = HydroReading & {
  station_code: string
  station_name: string
  river_name?: string | null
}

export type InboundSensorRecord = {
  id: string
  sensor_id: string
  sensor_code: string
  sensor_type: string
  numeric_value: number | null
  unit: string | null
  observed_at: string
  battery_percentage?: number | null
  latitude?: number | null
  longitude?: number | null
  quality_score?: number | null
  station_id?: string | null
  station_name?: string | null
  station_code?: string | null
  river_name?: string | null
}

export type InboundCommunityRecord = {
  id: string
  report_code: string
  village_id: string
  village_name?: string | null
  station_id: string
  station_name?: string | null
  station_code?: string | null
  submitted_at: string
  report_type: string
  description?: string | null
  severity: string
  verification_status: string
  trust_score?: number | null
  latitude?: number | null
  longitude?: number | null
}

export type InboundEvaluationRecord = RuleEvaluation & {
  station_name?: string | null
  station_code?: string | null
  river_name?: string | null
}

export type InboundSummary = {
  river: River
  counts: {
    hydro: number
    sensors: number
    community: number
    evaluations: number
  }
  latest_received_at: string | null
  hydro: InboundHydroRecord[]
  sensors: InboundSensorRecord[]
  community: InboundCommunityRecord[]
  evaluations: InboundEvaluationRecord[]
}

export type DeliveryRecord = {
  id: string
  village_id: string
  channel: string
  delivery_status: string
  attempt_number?: number | null
  sent_at?: string | null
  delivered_at?: string | null
  acknowledged_at?: string | null
  failure_reason?: string | null
  is_simulated?: boolean | null
  metadata?: Record<string, unknown> | null
}

export type AlertTarget = {
  id: string
  alert_id: string
  village_id: string
  risk_score?: number | null
  time_to_impact_minutes?: number | null
  target_priority?: string | null
  target_status?: string | null
}

export type VillageDeliveryRow = {
  village: Village
  impact: ImpactAssessment | null
  target: AlertTarget | null
  deliveries: DeliveryRecord[]
  delivery_state: string
  route: string[]
  is_simulated_delivery: boolean
}

export type VillageDeliverySummary = {
  river: River
  stations: Array<{
    id: string
    station_code: string
    station_name: string
    river_name?: string | null
  }>
  alert: Alert | null
  event_id: string | null
  summary: {
    villages: number
    targeted: number
    delivered: number
    deliveries: number
  }
  villages: VillageDeliveryRow[]
}

export function getVillageDeliverySummary(riverCode: string) {
  return apiRequest<VillageDeliverySummary>(
    `/village-delivery/summary?river_code=${encodeURIComponent(riverCode)}`,
  )
}

export type CommunityReport = {
  id: string
  report_code?: string | null
  village_id: string
  station_id?: string | null
  submitted_at: string
  latitude?: number | null
  longitude?: number | null
  report_type: string
  description?: string | null
  severity: string
  multimedia_url?: string | null
  verification_status?: string | null
  trust_score?: number | null
  reporter_user_id?: string | null
  metadata?: Record<string, unknown> | null
}

export type VillageAuthorityDelivery = {
  id: string
  alert_id?: string | null
  village_id: string
  channel: string
  delivery_status: string
  attempt_number?: number | null
  sent_at?: string | null
  delivered_at?: string | null
  acknowledged_at?: string | null
  failure_reason?: string | null
  is_simulated?: boolean | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export type VillageAuthoritySummary = {
  mode: 'demo' | 'authenticated'
  demo_only: boolean
  village: Village
  basin: River
  station: Station | null
  latest_reading: HydroReading | null
  latest_evaluation: RuleEvaluation | null
  current_alert: Alert | null
  alert_target: {
    alert_id: string
    target_status?: string | null
    risk_score?: number | null
    time_to_impact_minutes?: number | null
    target_priority?: string | null
  } | null
  impact: ImpactAssessment | null
  deliveries: VillageAuthorityDelivery[]
  reports: CommunityReport[]
}


export type CommunityMemberSummary = {
  mode: 'demo' | 'authenticated'
  demo_only: boolean
  village: Village
  basin: River
  station: Station | null
  latest_reading: HydroReading | null
  current_alert: Alert | null
  impact: ImpactAssessment | null
  latest_delivery: VillageAuthorityDelivery | null
}

export function getCommunityMemberSummary(villageId: string) {
  return apiRequest<CommunityMemberSummary>(
    `/community-member/summary?village_id=${encodeURIComponent(villageId)}`,
  )
}

export function submitDemoCommunityReport(payload: {
  village_id: string
  station_id: string
  report_type: string
  severity: string
  description?: string
  latitude?: number | null
  longitude?: number | null
}) {
  return apiRequest<{ report: CommunityReport; evaluation: unknown }>('/community-member/demo/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function acknowledgeDemoWarning(payload: { village_id: string; alert_id?: string | null }) {
  return apiRequest<{ delivery: unknown; acknowledged_at: string }>('/community-member/demo/acknowledge', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type CommunityReportOption = {
  value: string
  label: string
}

export type CommunityReportOptions = {
  rivers: Array<{ code: string; name: string }>
  report_types: CommunityReportOption[]
  severity_levels: CommunityReportOption[]
}

export function getVillageAuthoritySummary(villageId: string, reportLimit = 12) {
  return apiRequest<VillageAuthoritySummary>(
    `/village-authority/summary?village_id=${encodeURIComponent(villageId)}&report_limit=${reportLimit}`,
  )
}

export function getCommunityReportOptions() {
  return apiRequest<CommunityReportOptions>('/community/options')
}

export function verifyCommunityReport(
  reportId: string,
  payload: { action: 'verified' | 'rejected' | 'request_clarification'; trust_score?: number | null; comments?: string },
) {
  return apiRequest<{ report: CommunityReport; evaluation: unknown }>(
    `/community/demo/reports/${encodeURIComponent(reportId)}/verify`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function fieldVerifyCommunityReport(
  reportId: string,
  payload: { decision: 'confirmed' | 'disputed'; comments?: string },
) {
  return apiRequest<{ report: CommunityReport; evaluation: unknown }>(
    `/community/demo/reports/${encodeURIComponent(reportId)}/field-verify`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function corroborateCommunityReport(
  reportId: string,
  payload: { comments?: string },
) {
  return apiRequest<{ report: CommunityReport; evaluation: unknown }>(
    `/community/demo/reports/${encodeURIComponent(reportId)}/corroborate`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function reviewCommunityReport(
  reportId: string,
  payload: { action: 'verified' | 'rejected' | 'request_clarification'; trust_score?: number | null; comments?: string },
) {
  return apiRequest<{ report: CommunityReport; evaluation: unknown }>(
    `/community/demo/reports/${encodeURIComponent(reportId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function approveAlert(alertId: string, payload?: { notes?: string }) {
  return apiRequest<{ alert: Alert }>(`/alerts/demo/${encodeURIComponent(alertId)}/approve`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export function rejectAlert(alertId: string, payload?: { reason?: string }) {
  return apiRequest<{ alert: Alert }>(`/alerts/demo/${encodeURIComponent(alertId)}/reject`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

export function submitSensorReading(
  payload: {
    sensor_code: string
    sensor_type: string
    numeric_value: number
    unit: string
    station_id?: string | null
    battery_percentage?: number | null
    latitude?: number | null
    longitude?: number | null
  },
  sensorKey?: string,
) {
  return apiRequest<{ reading: unknown; evaluation: unknown }>('/sensors/readings', {
    method: 'POST',
    headers: sensorKey ? { 'x-sensor-key': sensorKey } : {},
    body: JSON.stringify({ metadata: {}, ...payload }),
  })
}

export function submitDemoVillageReport(payload: {
  village_id: string
  station_id: string
  report_type: string
  severity: string
  description?: string
  latitude?: number | null
  longitude?: number | null
}) {
  return apiRequest<{ report: CommunityReport; evaluation: unknown }>('/village-authority/demo/reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type AdminSummary = {
  metrics: {
    active_alerts: number
    community_reports: number
    user_profiles: number
    hydro_stations: number
    hydro_readings: number
    sensor_readings: number
    rule_evaluations: number
    events: number
    alert_deliveries: number
  }
  service_checks: Array<{
    key: string
    label: string
    status: 'ok' | 'attention'
    detail: string
  }>
  basins: Array<{
    code: string
    name: string
    station_code?: string | null
    station_name?: string | null
    latest_water_level_m?: number | null
    latest_observed_at?: string | null
    latest_risk_level?: string | null
    village_count: number
    active_alerts: number
  }>
  role_counts: Array<{
    role: string
    label: string
    count: number
  }>
  freshness: Array<{
    label: string
    timestamp?: string | null
  }>
  source_errors: string[]
}

export function getAdminSummary() {
  return apiRequest<AdminSummary>('/admin/summary')
}
