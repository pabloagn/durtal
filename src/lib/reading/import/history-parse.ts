import { z } from "zod/v4";
import { NOTE_KINDS, NOTE_SOURCES, READING_FORMATS, SESSION_SOURCES } from "../constants";
import { pagePlaceError } from "@/lib/validations/reading-notes";
import { day, invalidUnicode, safeRawCell } from "./fields";
import { importedThought } from "./thought";
import type { HistoryPayload, ImportRow, ParsedFile } from "./types";

export function integerCell(value: string | undefined, name: string, max = 2147483647, min = 0): number | null {
  if (value == null || value === "") return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`Invalid ${name}`);
  return Number(value);
}
export function percentCell(value: string | undefined, name: string): number | null {
  if (value == null || value === "") return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 100) throw new Error(`Invalid ${name}`);
  return Number(value);
}
export function uuidCell(value: string | undefined, name: string, required = false): string | null {
  if (!value && !required) return null;
  if (!z.uuid().safeParse(value).success) throw new Error(`Invalid ${name}`);
  return value!.toLowerCase();
}
export function textCell(value: string | undefined, name: string, max: number, required = false): string | null {
  if (value == null || value === "") { if (required) throw new Error(`Missing ${name}`); return null; }
  if (value.length > max || value.includes("\u0000") || (required && !value.trim())) throw new Error(`Invalid ${name}`);
  return value;
}
export function instantCell(value: string | undefined, name: string): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!m || !day(m[1]) || m[1].startsWith("0000-") || Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4]) > 59) throw new Error(`Invalid ${name}`);
  if (m[6] !== "Z" && (Number(m[6].slice(1,3)) > 14 || Number(m[6].replace(":", "").slice(3) || 0) > 59)) throw new Error(`Invalid ${name} offset`);
  return value;
}
export function instantValue(value: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value)!;
  const zone = m[6] === "Z" ? "Z" : m[6].length === 3 ? `${m[6]}:00` : m[6].length === 5 ? `${m[6].slice(0,3)}:${m[6].slice(3)}` : m[6];
  return BigInt(Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${zone}`)) * BigInt(1000) + BigInt((m[5] ?? "").padEnd(6,"0"));
}
function member(value: string, values: readonly string[], name: string): string {
  if (!values.includes(value)) throw new Error(`Invalid ${name}`);
  return value;
}
function booleanCell(value: string | undefined, name: string) {
  if (!value || value === "no" || value === "false") return false;
  if (value === "yes" || value === "true") return true;
  throw new Error(`Invalid ${name}`);
}
export function historyRow(kind: "sessions" | "notes", cells: Record<string,string>): ImportRow {
  const invalid = Object.values(cells).some(invalidUnicode);
  if (invalid) cells = Object.fromEntries(Object.entries(cells).map(([key,value]) => [key,safeRawCell(value)]));
  const row: ImportRow = { kind, durtalRestore:true, rawCells:cells, sourceBookId:null, title:cells.title ?? cells.work_title ?? "", authors:[], isbn13:null, isbn10:null, fileRating:null, rating:null, reviewHtml:null, shelves:[], privateNotes:null, pages:null, extras:{}, workId:null, editionId:null, instanceId:null, readings:[], warnings:[], error:null };
  try {
    if (invalid) throw new Error("A cell contains a character PostgreSQL cannot store");
    if (cells.export_version && cells.export_version !== "3") throw new Error("Unsupported Durtal export version");
    const history: HistoryPayload = { entity:kind, id:uuidCell(cells[kind === "sessions" ? "session_id" : "note_id"], "record id",true)!,
      workId:uuidCell(cells.work_id,"work_id"), readingId:uuidCell(cells.reading_id,"reading_id",kind === "sessions"),
      readingSourceKey:textCell(cells.reading_source_key,"reading_source_key",500), editionId:uuidCell(cells.edition_id,"edition_id"),
      source:member(cells.source,kind === "sessions" ? SESSION_SOURCES : NOTE_SOURCES,"source"),
      createdAt:instantCell(cells.created_at,"created_at"), updatedAt:instantCell(cells.updated_at,"updated_at"), values:{} };
    if (cells.export_version === "3") {
      const required = kind === "sessions" ? ["work_id","reading_source_key","edition_id","pages_total","note","paused_seconds","created_at","updated_at"]
        : ["reading_source_key","source_key","thought_html","thought_json","updated_at"];
      if (required.some((key) => !Object.hasOwn(cells,key)) || !history.workId) throw new Error("Version 3 restore columns are missing");
    }
    const v = history.values;
    if (kind === "sessions") {
      v.format = member(cells.format,READING_FORMATS,"format");
      const normalizedDay = day(cells.day);
      if (!normalizedDay || normalizedDay.startsWith("0000-")) throw new Error("Invalid day");
      v.read_on = normalizedDay;
      v.time_zone = textCell(cells.time_zone,"time_zone",100,true);
      try { new Intl.DateTimeFormat("en",{timeZone:v.time_zone! as string}); } catch { throw new Error("Invalid time_zone"); }
      v.started_at = instantCell(cells.started_at,"started_at"); v.ended_at = instantCell(cells.ended_at,"ended_at");
      if (v.started_at && v.ended_at && instantValue(String(v.ended_at)) < instantValue(String(v.started_at))) throw new Error("Session ends before it starts");
      if (history.source === "timer" && !v.ended_at) throw new Error("A running timer cannot be restored");
      v.duration_seconds = integerCell(cells.duration_seconds,"duration_seconds",86400,1);
      for (const key of ["start_page","end_page","start_minutes","end_minutes"] as const) v[key] = integerCell(cells[key],key);
      for (const key of ["start_percent","end_percent"] as const) v[key] = percentCell(cells[key],key);
      v.pages_total = integerCell(cells.pages_total,"pages_total",2147483647,1);
      v.end_chapter = textCell(cells.end_chapter,"end_chapter",300);
      v.note = textCell(cells.note,"note",2000);
      v.paused_seconds = integerCell(cells.paused_seconds,"paused_seconds",86400) ?? 0;
      if (!Object.hasOwn(cells,"pages_total")) row.warnings.push("Legacy file: original page total, edition and note are unavailable; no values are inferred.");
    } else {
      v.kind = member(cells.kind,NOTE_KINDS,"kind"); v.body = textCell(cells.body,"body",10000,true);
      v.page = integerCell(cells.page,"page"); v.end_page = integerCell(cells.end_page,"end_page");
      v.page_roman = booleanCell(cells.page_roman,"page_roman"); v.percent = percentCell(cells.percent,"percent");
      v.chapter = textCell(cells.chapter,"chapter",300); v.is_favourite = booleanCell(cells.favourite,"favourite");
      if (v.page !== null && v.percent !== null) throw new Error("Send a page or a percent, not both");
      const problem = pagePlaceError({page:v.page,endPage:v.end_page,pageRoman:v.page_roman}); if (problem) throw new Error(problem);
      const thought = importedThought(cells);
      if (v.kind !== "quote" && (thought.html !== null || thought.json !== null)) throw new Error("Only quotes may contain a thought");
      v.comment_html = thought.html; v.comment_json = thought.json === null ? null : JSON.stringify(thought.json);
      v.source_key = textCell(cells.source_key,"source_key",500);
      if (!Object.hasOwn(cells,"thought_html") && !Object.hasOwn(cells,"thought_json")) row.warnings.push("Legacy thought is plain text; original formatting is unavailable.");
    }
    if (cells.export_version === "3" && (!history.createdAt || !history.updatedAt)) throw new Error("Version 3 requires original timestamps");
    if (!history.createdAt) row.warnings.push("Legacy file: original creation time is unavailable; import time is used.");
    if (!history.updatedAt) row.warnings.push("Legacy file: original update time is unavailable; creation time is used.");
    history.summary = kind === "sessions" ? [v.read_on,
      v.start_page != null || v.end_page != null ? `pages ${v.start_page ?? "?"}–${v.end_page ?? "?"}`
        : v.start_percent != null || v.end_percent != null ? `${v.start_percent ?? "?"}–${v.end_percent ?? "?"}%` : null,
      v.duration_seconds ? `${v.duration_seconds} seconds` : null].filter(Boolean).join(" · ") : String(v.body).slice(0,180);
    row.history=history;row.workId=history.workId;row.editionId=history.editionId;
  } catch (error) { row.error=error instanceof Error ? error.message : "Invalid history row"; }
  return row;
}
export function mapHistory(kind: "sessions" | "notes", records: Record<string,string>[]): ParsedFile {
  const rows=records.map((cells)=>historyRow(kind,cells));
  const ids=new Set<string>();
  for (const row of rows) if(row.history) { if(ids.has(row.history.id)) row.error="Duplicate record id in this file";ids.add(row.history.id); }
  return {source:"durtal",rows,missing:[]};
}
