// Map risk signals to the palette so color encodes meaning, not decoration.
// Grades run A→F (best→worst); report severities run info→critical.

const GRADE_CLASS: Record<string, string> = {
  A: 'grade grade-a',
  B: 'grade grade-b',
  C: 'grade grade-c',
  D: 'grade grade-d',
  F: 'grade grade-f',
};

export function riskGradeClass(grade: string): string {
  return GRADE_CLASS[grade.toUpperCase()] ?? 'grade grade-unrated';
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'badge sev-critical',
  high: 'badge sev-high',
  medium: 'badge sev-medium',
  warning: 'badge sev-warning',
  low: 'badge sev-low',
  info: 'badge sev-info',
  pass: 'badge sev-pass',
};

export function severityClass(severity: string): string {
  return SEVERITY_CLASS[severity.toLowerCase()] ?? 'badge';
}
