"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Loader2,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  SettingFact,
  SettingsGroup,
  SettingsIntro,
} from "@/components/settings/settings-group";
import { checkIntegration } from "@/lib/actions/integrations";
import { publicEnv } from "@/lib/env";
import type {
  CheckResult,
  CheckStatus,
  IntegrationId,
  IntegrationInfo,
  IntegrationsOverview,
} from "@/lib/settings/integrations";

const STATUS: Record<CheckStatus | "checking", { label: string; icon: LucideIcon; color: string }> = {
  ok: { label: "Working", icon: CircleCheck, color: "text-accent-sage" },
  warning: { label: "Needs attention", icon: TriangleAlert, color: "text-accent-gold" },
  error: { label: "Not working", icon: CircleX, color: "text-accent-red-text" },
  off: { label: "Not set up", icon: CircleMinus, color: "text-fg-secondary" },
  checking: { label: "Checking", icon: Loader2, color: "text-fg-secondary" },
};

/** Mapbox serves the browser, so the browser checks it, the way the authors map loads it. */
async function checkMapbox(): Promise<CheckResult> {
  const token = publicEnv.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return { status: "off", message: "NEXT_PUBLIC_MAPBOX_TOKEN is not set" };
  const start = performance.now();
  try {
    const res = await fetch(
      `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) return { status: "ok", message: `Answered in ${Math.round(performance.now() - start)} ms` };
    if (res.status === 401) return { status: "error", message: "Mapbox refused the token" };
    if (res.status === 403) return { status: "error", message: "The token does not allow this site" };
    return { status: "error", message: `Mapbox answered with status ${res.status}` };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof DOMException && error.name === "TimeoutError"
          ? "Mapbox did not answer within 8 s"
          : "Mapbox could not be reached",
    };
  }
}

/** A status with its icon on the first line, then what it means. `label` replaces the status's own word. */
function StatusCell({
  result,
  label: ownLabel,
}: {
  result: CheckResult | "checking" | undefined;
  label?: string;
}) {
  const status = result === undefined || result === "checking" ? "checking" : result.status;
  const { label: statusLabel, icon: Icon, color } = STATUS[status];
  const label = ownLabel ?? statusLabel;
  return (
    <div className="min-w-0 sm:text-right" aria-live="polite">
      <p className={`flex items-start gap-1.5 text-sm sm:justify-end ${color}`}>
        <CapAligned height={14}>
          <Icon
            className={`block h-3.5 w-3.5 ${status === "checking" ? "motion-safe:animate-spin" : ""}`}
            strokeWidth={1.5}
            aria-hidden
          />
        </CapAligned>
        <span>{label}</span>
      </p>
      {typeof result === "object" && (
        <p className="mt-1 text-xs text-fg-secondary">{result.message}</p>
      )}
    </div>
  );
}

function ServiceRow({ service, result }: { service: IntegrationInfo; result: CheckResult | "checking" | undefined }) {
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-8">
      <div className="min-w-0">
        <p className="text-sm text-fg-primary">{service.name}</p>
        <p className="mt-1 text-xs text-fg-secondary">{service.purpose}</p>
        {service.env.length > 0 && (
          <ul aria-label="Environment variables" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {service.env.map((variable) => (
              <li key={variable.name} className="font-mono text-micro text-fg-secondary">
                {variable.name}{" "}
                <span
                  className={
                    variable.set
                      ? "text-accent-sage"
                      : variable.optional
                        ? "text-fg-secondary"
                        : "text-accent-red-text"
                  }
                >
                  {variable.set ? "set" : variable.optional ? "not set (optional)" : "not set"}
                </span>
              </li>
            ))}
          </ul>
        )}
        {service.facts.length > 0 && (
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {service.facts.map((fact) => (
              <div key={fact.label} className="flex gap-1.5">
                <dt className="text-fg-secondary">{fact.label}</dt>
                <dd className="text-fg-primary">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <StatusCell result={result} />
    </div>
  );
}

/**
 * The outside services with a live check of each. The checks run when the
 * page opens and on "Check again", all at once.
 */
export function IntegrationChecks({ overview }: { overview: IntegrationsOverview }) {
  const [results, setResults] = useState<Partial<Record<IntegrationId, CheckResult | "checking">>>({});
  const checking = Object.values(results).some((result) => result === "checking");

  const runAll = useCallback(() => {
    for (const service of overview.services) {
      setResults((current) => ({ ...current, [service.id]: "checking" }));
      const check = service.checkFrom === "browser" ? checkMapbox() : checkIntegration(service.id);
      check
        .catch((): CheckResult => ({ status: "error", message: "The check failed" }))
        .then((result) => setResults((current) => ({ ...current, [service.id]: result })));
    }
  }, [overview.services]);

  // Once when the page opens (development mounts twice; a check can spend a paid call)
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runAll();
  }, [runAll]);

  const { calibre, access } = overview;
  return (
    <>
      <SettingsIntro>
        The outside services Durtal uses, checked live: each check asks for one small answer.
        Keys and tokens are never shown, only whether they are set.
      </SettingsIntro>

      <SettingsGroup
        title="Services"
        action={
          <Button size="sm" onClick={runAll} disabled={checking}>
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
            Check again
          </Button>
        }
      >
        {overview.services.map((service) => (
          <ServiceRow key={service.id} service={service} result={results[service.id]} />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Calibre library"
        description="The sync script (scripts/calibre_sync) copies the ebooks of a Calibre library to storage for the reader. It runs on the machine that holds the library."
      >
        <SettingFact label="Books">{calibre.books}</SettingFact>
        <SettingFact label="Linked to a book in the catalogue">{calibre.linked}</SettingFact>
        <SettingFact label="Last sync">{calibre.lastSynced ?? "Never"}</SettingFact>
      </SettingsGroup>

      <SettingsGroup title="Access">
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-8">
          <div className="min-w-0">
            <p className="text-sm text-fg-primary">REST API writes</p>
            <p className="mt-1 text-xs text-fg-secondary">
              Orders, copies, works, editions and collections through /api.
            </p>
          </div>
          <StatusCell
            label={access.restToken ? "Protected" : "Off"}
            result={
              access.restToken
                ? { status: "ok", message: "They ask for DURTAL_API_TOKEN" }
                : { status: "off", message: "Refused: DURTAL_API_TOKEN is not set" }
            }
          />
        </div>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:gap-8">
          <div className="min-w-0">
            <p className="text-sm text-fg-primary">Media maintenance routes</p>
            <p className="mt-1 text-xs text-fg-secondary">
              Reprocess thumbnails, apply crops, fill colour palettes.
            </p>
          </div>
          <StatusCell
            label={access.adminToken ? "Protected" : "Off"}
            result={
              access.adminToken
                ? { status: "ok", message: "They ask for ADMIN_TOKEN" }
                : { status: "off", message: "Refused: ADMIN_TOKEN is not set" }
            }
          />
        </div>
      </SettingsGroup>
    </>
  );
}
