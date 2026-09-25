export type RiverCode = 'TEESTA' | 'DESANG'

export type RoleKey =
  | 'control_room'
  | 'disaster_authority'
  | 'village_authority'
  | 'community_manager'
  | 'community_member'
  | 'admin'

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
  data_mode?: 'historical' | 'replay' | 'live' | string | null
}

export type SensorReading = {
  id: string
  sensor_id?: string | null
  observed_at: string
  numeric_value: number
  unit: string
  battery_percentage?: number | null
  latitude?: number | null
  longitude?: number | null
  quality_score?: number | null
  raw_data?: Record<string, unknown> | null
}

export type SensorDevice = {
  id: string
  sensor_code: string
  sensor_type: string
  unit: string
  is_simulated?: boolean | null
  is_active?: boolean | null
}

export type CommunityReport = {
  id: string
  report_code?: string | null
  village_id: string
  station_id: string
  submitted_at: string
  latitude?: number | null
  longitude?: number | null
  report_type: string
  description?: string | null
  severity: 'low' | 'moderate' | 'high' | 'critical' | string
  multimedia_url?: string | null
  verification_status?: string | null
  trust_score?: number | null
  metadata?: Record<string, unknown> | null
}

export type RuleEvaluation = {
  id: string
  hydro_reading_id?: string | null
  event_id?: string | null
  total_score: number
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

export type AlertTarget = {
  id: string
  alert_id: string
  village_id: string
  status?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
}

export type AlertDelivery = {
  id: string
  alert_id: string
  alert_target_id?: string | null
  channel?: string | null
  status?: string | null
  created_at?: string | null
  delivered_at?: string | null
  metadata?: Record<string, unknown> | null
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

export type UserProfile = {
  id: string
  email?: string | null
  full_name?: string | null
  role: RoleKey
  village_id?: string | null
}

export type DashboardSummary = {
  stations: Array<{
    station: Station
    latest_reading: HydroReading | null
  }>
  recent_evaluations: RuleEvaluation[]
  active_alerts: Alert[]
}

export type VillagesResponse = {
  river: River
  items: Village[]
}

export type AlertDetails = {
  alert: Alert
  targets: AlertTarget[]
  deliveries: AlertDelivery[]
}

export type AlertImpactResponse = {
  event_id: string | null
  items: ImpactAssessment[]
}

export type ApiHealth = {
  status: string
  service: string
}
