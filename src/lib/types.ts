// Tipos del contrato (Swagger de la API de Lumon, v2.0.0).

export type Permission =
  | 'files:read'
  | 'files:refine'
  | 'refiners:read'
  | 'refiners:write'
  | 'media:upload'
  | 'incidents:read'
  | 'incidents:create'
  | 'team:manage'

export interface User {
  id: number
  email: string
  displayName: string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface LoginResponse extends TokenPair {
  user: User
}

export interface RegisterResponse extends LoginResponse {
  team: { code: string; name: string }
}

export interface ClearanceStatus {
  granted: boolean
  grantedAt: string | null
}

export interface Me {
  id: number
  email: string
  displayName: string
  team: { code: string; name: string }
  role: { code: string; name: string }
  permissions: Permission[]
  clearance: ClearanceStatus
}

export interface Health {
  status: 'ok'
  service: string
  time: string
}

export type Bin = 'WO' | 'FC' | 'DR' | 'MA'
export const BINS: readonly Bin[] = ['WO', 'FC', 'DR', 'MA']
export const BIN_CHAR: Record<Bin, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' }
export const CHAR_BIN: Record<string, Bin> = { W: 'WO', F: 'FC', D: 'DR', M: 'MA' }

export interface Progress {
  WO: number
  FC: number
  DR: number
  MA: number
  overall: number
}

export type FileStatus = 'ACTIVE' | 'COMPLETE'

export interface DataFile {
  id: number
  name: string
  rows: number
  cols: number
  tileSize: number
  status: FileStatus
  progress: Progress
  refinedGroups: number
  totalGroups: number
  mistakes: number
  updatedAt: string
}

export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  page: number
  size: number
}

export interface Rules {
  tremorThreshold: number
  connectivity: 4 | 8
  minGroupSize: number
  maxGroupSize: number
  binning: { strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD'; order: Bin[] }
}

export interface TileResponse {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  values: string
  tremor: string
  bins: string
  version: number
}

export interface Cell {
  r: number
  c: number
}

export interface RefineResult {
  refinementId: number
  bin: Bin
  size: number
  file: {
    progress: Progress
    refinedGroups: number
    totalGroups: number
    mistakes: number
    status: FileStatus
  }
}

export interface Check {
  name: string
  passed: boolean
  detail: string
}

export interface DeployChallenge {
  origin: string
  token: string
  wellKnownPath: string
  expiresAt: string
}

export interface StorageResult {
  provider: 'SUPABASE' | 'CLOUDINARY'
  verifiedAt: string
  checks: Check[]
}

export interface IntegrationStatus {
  deploy: {
    origin: string | null
    verifiedAt: string | null
    lastBuildSeen: string | null
    lastBuildSeenAt: string | null
    pendingChallenge: { origin: string; expiresAt: string } | null
  }
  storage: {
    provider: 'SUPABASE' | 'CLOUDINARY' | null
    verifiedAt: string | null
    checks: Check[]
    config: Record<string, string> | null
  }
  clearance: ClearanceStatus
}

export interface RosterMember {
  name: string
  code: string
}

export interface Roster {
  members: RosterMember[]
  complete: boolean
  locked: boolean
}

export interface RoundInfo {
  number: number
  startsAt: string
  drawAt: string
  drawnAt: string | null
  resultsPublishedAt: string | null
}

export interface Clearance {
  granted: boolean
  grantedAt: string | null
  checks: Check[]
  checkedAt: string | null
  workspace: { kind: 'DEV' | 'EVAL'; chaosLevel: 0 | 1 | 2 }
  roster: Roster
  round: {
    approved: boolean
    approvedAt: string | null
    approvedRound: number | null
    nextRoundAt: string | null
    nextRound: RoundInfo | null
    drawnMember: { round: number; name: string; code: string; startsAt: string } | null
    attempts: {
      round: number
      startsAt: string
      member: RosterMember
      result: 'PASSED' | 'FAILED' | 'ABSENT' | null
      gradedAt: string | null
    }[]
    schedule: RoundInfo[]
  }
}

export interface ClearanceCheckResult {
  granted: boolean
  grantedAt: string | null
  checks: Check[]
}

export interface Department {
  id: number
  code: string
  name: string
}

export interface Refiner {
  id: number
  fullName: string
  department: Department
  title: string
  extension: string
  bio: string
  profileUrl: string | null
  badge: { url: string; width: number; height: number } | null
  version: number
  updatedAt: string
}

export interface RefinerPatch {
  title?: string
  extension?: string
  bio?: string
  departmentId?: number
  badgeMediaId?: number | null
}

export type MediaPurpose = 'BADGE' | 'INCIDENT'

export interface MediaTicket {
  ticketId: string
  expiresAt: string
  provider: 'SUPABASE' | 'CLOUDINARY'
  objectPath?: string
  bucket?: string
  uploadPublicId?: string
  expectedPublicId?: string
  constraints: {
    contentType?: string
    width?: number
    height?: number
    minLongSide?: number
    maxLongSide?: number
    maxBytes?: number
  }
}

export interface Media {
  mediaId: number
  url: string
  width: number
  height: number
  purpose: MediaPurpose
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export const SEVERITIES: readonly Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export interface Incident {
  id: number
  title: string
  description: string
  severity: Severity
  fileId: number | null
  file: { id: number; name: string } | null
  photos: { mediaId: number; url: string; width: number; height: number }[]
  createdBy: { id: number; displayName: string }
  createdAt: string
}

export interface Ticket {
  ticket: string
  expiresIn: number
}
