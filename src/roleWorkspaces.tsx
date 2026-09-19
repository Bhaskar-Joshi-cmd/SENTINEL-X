import type { ReactNode } from 'react'
import {
  CheckCircle2,
  Database,
  MapPin,
  ShieldCheck,
  Siren,
  Users,
  WifiOff,
} from 'lucide-react'
import type { Alert, DashboardSummary, HydroReading, ImpactAssessment, RuleEvaluation, Station } from './api'
import DisasterAuthorityPage from './DisasterAuthorityPage'
import VillageAuthorityPage from './VillageAuthorityPage'
import CommunityMemberPage from './CommunityMemberPage'
import AdminPage from './AdminPage'

export type RoleKey = 'control_room' | 'disaster_authority' | 'village_authority' | 'community_member' | 'admin'
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

type Props = {
  role: RoleKey
  riverCode: 'TEESTA' | 'DESANG'
  station: Station | undefined
  reading: HydroReading | null | undefined
  latestEvaluation: RuleEvaluation | null
  activeAlert: Alert | null
  dashboard: DashboardSummary | null
  zones: Zone[]
  impactAssessments: ImpactAssessment[]
  networks: Record<NetworkKey, boolean>
  totalPopulationAtRisk: number
  nearestImpact: ImpactAssessment | null
  onSelectVillage: (id: string) => void
  onReviewAlert: () => void
}

const ROLE_META: Record<RoleKey, { label: string; title: string; description: string }> = {
  control_room: {
    label: 'Control Room',
    title: 'Operations command',
    description: 'Monitor hazard state, review alerts, manage routing and oversee last-mile delivery.',
  },
  disaster_authority: {
    label: 'Disaster Authority',
    title: 'Regional emergency oversight',
    description: 'Review regional impact, warning readiness and the human authorization gate.',
  },
  village_authority: {
    label: 'Village Authority',
    title: 'Local village operations',
    description: 'Track the village warning, local conditions and the last-mile communication state.',
  },
  community_member: {
    label: 'Community Member',
    title: 'Emergency information',
    description: 'Receive an actionable warning, understand the urgency and report local conditions.',
  },
  admin: {
    label: 'System Admin',
    title: 'System administration',
    description: 'Monitor platform health, integrations, users and operational data freshness.',
  },
}

function riskClass(risk: string | null | undefined) {
  return String(risk ?? 'watch').toLowerCase()
}

function number(value: number | null | undefined) {
  return typeof value === 'number' ? value.toLocaleString('en-IN') : '—'
}

function time(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function eta(value: number | null | undefined) {
  return typeof value === 'number' ? `${Math.round(value)} min` : '—'
}

function WorkspaceHeader({ role, riverCode }: { role: RoleKey; riverCode: 'TEESTA' | 'DESANG' }) {
  const meta = ROLE_META[role]
  const isVillageAuthority = role === 'village_authority'
  return (
    <section className="role-hero panel">
      <div>
        <span className="section-kicker">{meta.label.toUpperCase()} / SENTINEL-X</span>
        <h1>{meta.title}</h1>
        <p>{meta.description}</p>
      </div>
      <div className="role-context">
        <span>{isVillageAuthority ? 'LOCAL IDENTITY' : 'ACTIVE BASIN'}</span>
        <b>{isVillageAuthority ? 'Selected village below' : riverCode === 'TEESTA' ? 'Teesta / Melli' : 'Desang / Nanglamoraghat'}</b>
        <small>AUTHORIZATION LAYER: {role === 'community_member' ? 'CITIZEN' : isVillageAuthority ? 'LOCAL' : 'OPERATIONAL'}</small>
      </div>
    </section>
  )
}

export function RoleWorkspace(props: Props) {
  const { role } = props
  return (
    <div className="role-workspace">
      <WorkspaceHeader role={role} riverCode={props.riverCode} />
      {role === 'disaster_authority' && <DisasterAuthorityPanel {...props} />}
      {role === 'village_authority' && <VillageAuthorityPanel {...props} />}
      {role === 'community_member' && <CommunityMemberPanel {...props} />}
      {role === 'admin' && <AdminPanel />}
    </div>
  )
}

function DisasterAuthorityPanel(props: Props) {
  const zones = props.zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    risk: zone.risk,
    riskScore: zone.riskScore,
    eta: zone.eta,
    population: zone.population,
    vulnerability: zone.vulnerability,
    downstreamOrder: zone.downstreamOrder,
  }))

  return (
    <DisasterAuthorityPage
      riverCode={props.riverCode}
      station={props.station}
      reading={props.reading}
      latestEvaluation={props.latestEvaluation}
      activeAlert={props.activeAlert}
      zones={zones}
      impactAssessments={props.impactAssessments}
      totalPopulationAtRisk={props.totalPopulationAtRisk}
      onReviewAlert={props.onReviewAlert}
    />
  )
}

function VillageAuthorityPanel(props: Props) {
  return <VillageAuthorityPage riverCode={props.riverCode} />
}

function CommunityMemberPanel(props: Props) {
  return <CommunityMemberPage riverCode={props.riverCode} />
}

function AdminPanel() {
  return <AdminPage />
}

function Channel({ label, active, icon }: { label: string; active: boolean; icon: ReactNode }) {
  return <div className={'channel-card ' + (active ? 'active' : 'inactive')}><div>{icon}</div><span>{label}</span><b>{active ? 'AVAILABLE' : 'OFFLINE'}</b></div>
}

function RoleRow({ label, detail, icon }: { label: string; detail: string; icon: ReactNode }) {
  return <div className="role-directory-row"><span className="role-directory-icon">{icon}</span><span><b>{label}</b><small>{detail}</small></span><em>ROLE</em></div>
}

export { ROLE_META }
