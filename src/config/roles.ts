import type { RoleKey } from '../types/api'

export type RoleNavItem = {
  id: string
  label: string
  description: string
}

export type RoleDefinition = {
  key: RoleKey
  label: string
  title: string
  description: string
  navigation: RoleNavItem[]
}

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  control_room: {
    key: 'control_room',
    label: 'Control Room',
    title: 'Operations command',
    description: 'Monitor hazard evidence, evaluate alerts, inspect inbound data and oversee last-mile delivery.',
    navigation: [
      { id: 'command', label: 'Command View', description: 'Current hazard, alert and impact picture.' },
      { id: 'inbound', label: 'Inbound Data', description: 'Who sent what evidence and when.' },
      { id: 'delivery', label: 'Village Delivery', description: 'What warning was sent to each village.' },
      { id: 'connectivity', label: 'Connectivity', description: 'Current and fallback communication paths.' },
      { id: 'audit', label: 'Audit', description: 'Operational activity and decision trail.' },
    ],
  },
  disaster_authority: {
    key: 'disaster_authority',
    label: 'Disaster Authority',
    title: 'Regional emergency oversight',
    description: 'Review regional impact, warning readiness and the human authorization boundary.',
    navigation: [
      { id: 'overview', label: 'Regional Dashboard', description: 'Regional hazard and population picture.' },
    ],
  },
  village_authority: {
    key: 'village_authority',
    label: 'Village Authority',
    title: 'Local village operations',
    description: 'Designated village / Gram Panchayat / VDMC representative. Corroborate the local situation, review field confirmations and coordinate the local response.',
    navigation: [
      { id: 'overview', label: 'Village Dashboard', description: 'Assigned village warning and local conditions.' },
    ],
  },
  community_manager: {
    key: 'community_manager',
    label: 'Community Manager',
    title: 'Field verification',
    description: 'Designated trained local field POC / volunteer (Aapda-Mitra type). The eyes on the ground: confirm or dispute village reports from the field.',
    navigation: [
      { id: 'overview', label: 'Field Desk', description: 'Village reports awaiting field confirmation or dispute.' },
    ],
  },
  community_member: {
    key: 'community_member',
    label: 'Community Member',
    title: 'Emergency information',
    description: 'Receive an actionable warning and report local conditions.',
    navigation: [
      { id: 'overview', label: 'My Warning', description: 'Current public warning and actions.' },
    ],
  },
  admin: {
    key: 'admin',
    label: 'System Admin',
    title: 'System administration',
    description: 'Monitor platform health and authorization data.',
    navigation: [
      { id: 'overview', label: 'System Dashboard', description: 'Service health and authorization overview.' },
    ],
  },
}

export function isRoleKey(value: string | null | undefined): value is RoleKey {
  return value === 'control_room'
    || value === 'disaster_authority'
    || value === 'village_authority'
    || value === 'community_manager'
    || value === 'community_member'
    || value === 'admin'
}
