export type ScanSeverity = 'high' | 'warn' | 'info';
export type Scanner = 'theme' | 'tokens' | 'hit-area';

export interface ScanHit {
  severity: ScanSeverity;
  rule: string;
  file: string;
  line: number;
  snippet: string;
  message: string;
}

export interface SuppressedHit extends ScanHit { reason: string }

export interface ScanException { path: string; rules: string[]; reason: string }

export interface ScanSettings {
  paths: string[];
  scanners: Scanner[];
  grid: number;
  maxPerRule: number;
  failOn: ScanSeverity | 'never';
  exceptions: ScanException[];
}

export interface TokenSummary {
  grid: number;
  font: Record<string, number>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
}

export interface ScanReport {
  root: string;
  files: number;
  hits: ScanHit[];
  suppressed: SuppressedHit[];
  tokens: TokenSummary;
  counts: Record<ScanSeverity, number>;
  failed: boolean;
}

export interface SourceFile { path: string; rel: string; ext: string; dir: string; name: string; lines: string[] }
