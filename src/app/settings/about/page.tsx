import { version as reactVersion } from "react";
import nextPackage from "next/package.json";
import durtalPackage from "../../../../package.json";
import {
  SettingFact,
  SettingsGroup,
  SettingsIntro,
} from "@/components/settings/settings-group";
import { DOMAIN_ORDER, WORK_DOMAINS } from "@/lib/catalogue/domains";
import { S3_BUCKET } from "@/lib/s3/client";
import { migrationState } from "@/lib/settings/about";

export const metadata = { title: "About Durtal" };

export default async function AboutSettingsPage() {
  const migrations = await migrationState();
  return (
    <>
      <SettingsIntro>The versions, the database schema, the storage and the collections.</SettingsIntro>

      <SettingsGroup title="Durtal">
        <SettingFact label="Version">{durtalPackage.version}</SettingFact>
        <SettingFact label="Next.js">{nextPackage.version}</SettingFact>
        <SettingFact label="React">{reactVersion}</SettingFact>
        <SettingFact label="Node.js">{process.version.replace(/^v/, "")}</SettingFact>
        <SettingFact label="Environment">
          {process.env.NODE_ENV === "production" ? "Production" : "Development"}
        </SettingFact>
      </SettingsGroup>

      <SettingsGroup title="Database">
        <SettingFact label="Provider">Neon Postgres</SettingFact>
        <SettingFact
          label="Schema"
          description={
            migrations.pending.length
              ? `Run pnpm db:migrate to apply: ${migrations.pending.join(", ")}`
              : undefined
          }
        >
          {migrations.pending.length === 0 ? (
            <span className="text-accent-sage">Up to date</span>
          ) : (
            <span className="text-accent-gold">
              {migrations.pending.length} {migrations.pending.length === 1 ? "migration" : "migrations"} waiting
            </span>
          )}
        </SettingFact>
        <SettingFact label="Latest migration">
          <span className="font-mono text-xs">{migrations.latest ?? "None"}</span>
        </SettingFact>
        <SettingFact label="Migrations in this build">{migrations.known}</SettingFact>
      </SettingsGroup>

      <SettingsGroup title="Storage">
        <SettingFact label="Provider">Amazon S3</SettingFact>
        <SettingFact label="Bucket">
          <span className="font-mono text-xs">{S3_BUCKET}</span>
        </SettingFact>
        <SettingFact label="Region">
          <span className="font-mono text-xs">{process.env.AWS_REGION ?? "us-east-1 (default)"}</span>
        </SettingFact>
      </SettingsGroup>

      <SettingsGroup
        title="Collections"
        description="A collection opens when its records, pages and checks are complete."
      >
        {DOMAIN_ORDER.map((kind) => (
          <SettingFact key={kind} label={WORK_DOMAINS[kind].pluralLabel}>
            {WORK_DOMAINS[kind].enabled ? (
              <span className="text-accent-sage">Open</span>
            ) : (
              <span className="text-fg-secondary">In development</span>
            )}
          </SettingFact>
        ))}
      </SettingsGroup>
    </>
  );
}
