export type Row = Record<string, unknown> & { id: string };
export type Dataset = Record<string, Row[]>;
export type Category = "duplicates" | "artwork" | "metadata" | "integrity";
export type Confidence = "high" | "medium" | "low";
export type Resolution =
  | { kind: "merge" }
  | { kind: "update"; changes: Record<string, unknown>; label: string }
  | {
      kind: "poster";
      s3Key: string;
      thumbnailS3Key: string | null;
      label: string;
    }
  | { kind: "review" };
export interface RecordRef {
  id: string;
  name: string;
  href: string;
  context: string;
}
export interface Finding {
  key: string;
  rule: string;
  entity: string;
  entityLabel: string;
  category: Category;
  confidence: Confidence;
  priority: number;
  title: string;
  explanation: string;
  evidence: string[];
  records: RecordRef[];
  resolution: Resolution;
  recommendedId?: string;
  fingerprint: string;
  dismissed?: boolean;
}
export interface Scan {
  findings: Finding[];
  scannedAt: string;
  recordCount: number;
  entityCount: number;
  ruleCount: number;
  persistenceAvailable: boolean;
  history: { id: string; action: string; label: string; createdAt: string }[];
}
export interface MergeField {
  key: string;
  label: string;
  source: unknown;
  target: unknown;
  conflict: boolean;
  display?: { source: string | null; target: string | null };
}
export interface MergePreview {
  entity: string;
  source: RecordRef;
  target: RecordRef;
  fingerprint: string;
  fields: MergeField[];
  relationships: { label: string; count: number }[];
  blockers: string[];
  sourceRecord: Row;
  targetRecord: Row;
}
