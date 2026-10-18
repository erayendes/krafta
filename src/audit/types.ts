import type { ThemeToggle, Scheme } from '../theme.js';
import type { Policy } from '../check/types.js';

export type Severity = 'error' | 'warn' | 'info';
export interface Rect { x: number; y: number; w: number; h: number }

// One measured lead. Gate findings come from the check rules and also fail `krafta check`.
export interface AuditFinding {
  id?: number;
  rule: string;
  severity: Severity;
  selector: string;
  // The exact selector the check rules report, for gate findings.
  fullSelector?: string;
  rect: Rect | null;
  text: string;
  message: string;
  source: 'audit' | 'check';
  tell?: boolean;
  coveredBy?: string;
  ratio?: number;
  fix?: string;
}

export interface TokenBucket { [value: string]: { n: number; ex: string[] } }
export interface Inventory {
  fontSize: TokenBucket;
  fontWeight: TokenBucket;
  fontFamily: TokenBucket;
  textColor: TokenBucket;
  radius: TokenBucket;
  shadow: TokenBucket;
  spacing: TokenBucket;
}
export interface LayoutShift { value: number; sources: string[] }
export interface PageAuditOptions { maxPerRule: number; mobile: boolean; touch: boolean; vpWidth: number }
export interface PageAuditResult {
  findings: AuditFinding[];
  allKeys: string[];
  perRule: Record<string, number>;
  inventory: Inventory;
  offGrid: { v: string; n: number; ex: string[] }[];
  leftEdges: { x: number; n: number }[];
  accentHues: { hue: number; n: number; ex: string; c: string }[];
  docH: number;
  docW: number;
  vw: number;
  vh: number;
  cls: number;
  shifts: LayoutShift[];
  darkCanvas: boolean;
}

export type StressKind = 'pseudo' | 'large-text';
export interface Tile { file: string; x: number; y: number; w: number; h: number }

export interface AuditRun {
  name: string;
  theme: Scheme;
  viewport: { width: number; height: number };
  stress: StressKind | null;
  state: string | null;
  allKeys: string[];
  leftEdges: PageAuditResult['leftEdges'];
  accentHues: PageAuditResult['accentHues'];
  vw: number;
  docH: number;
  cls: number;
  findings: AuditFinding[];
  perRule: Record<string, number>;
  maxPerRule: number;
  inventory: Inventory;
  offGrid: PageAuditResult['offGrid'];
  focusStops?: number;
  gate: boolean;
  tiles: Tile[] | null;
  tileGrid: string;
  notes: string[];
}

export interface AuditSettings {
  viewports: { width: number; height: number }[];
  themes: Scheme[];
  stress: boolean;
  states: string[];
  stateParam: string;
  maxPerRule: number;
  focus: boolean;
  tiles: boolean;
  maxHeight: number;
  wait: number;
}

export interface AuditOptions extends Partial<AuditSettings> {
  out?: string;
  waitFor?: string;
  storageState?: string;
  theme?: ThemeToggle;
  // The check policy. Set to false to skip the gate rules.
  policy?: Partial<Policy> | false;
  log?: (line: string) => void;
}

export interface AuditReport {
  target: string;
  out: string;
  runs: AuditRun[];
  failedRuns: { name: string; error: string }[];
  totals: Record<Severity, number>;
  gateFindings: number;
}
