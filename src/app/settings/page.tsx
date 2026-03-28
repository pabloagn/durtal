import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Settings" };

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-fg-secondary">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-glass-border" />;
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Application configuration"
      />

      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-fg-primary">Database</h2>
          </CardHeader>
          <CardContent>
            <SettingRow label="Provider">
              <span className="font-mono text-xs text-fg-primary">Neon</span>
            </SettingRow>
            <Divider />
            <SettingRow label="Status">
              <span className="font-mono text-xs text-accent-sage">
                Connected
              </span>
            </SettingRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-fg-primary">
              External APIs
            </h2>
          </CardHeader>
          <CardContent>
            <SettingRow label="Google Books">
              <span className="font-mono text-xs text-fg-muted">
                {process.env.GOOGLE_BOOKS_API_KEY
                  ? "Configured"
                  : "Not configured"}
              </span>
            </SettingRow>
            <Divider />
            <SettingRow label="Open Library">
              <span className="font-mono text-xs text-accent-sage">
                Available (no key required)
              </span>
            </SettingRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-fg-primary">
              Storage (S3)
            </h2>
          </CardHeader>
          <CardContent>
            <SettingRow label="Bucket">
              <span className="font-mono text-xs text-fg-primary">
                {process.env.S3_BUCKET ?? "durtal"}
              </span>
            </SettingRow>
            <Divider />
            <SettingRow label="Region">
              <span className="font-mono text-xs text-fg-primary">
                {process.env.AWS_REGION ?? "us-east-1"}
              </span>
            </SettingRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-lg text-fg-primary">About</h2>
          </CardHeader>
          <CardContent>
            <SettingRow label="Application">
              <span className="font-serif text-fg-primary">Durtal</span>
            </SettingRow>
            <Divider />
            <SettingRow label="Version">
              <span className="font-mono text-xs text-fg-muted">0.1.0</span>
            </SettingRow>
            <Divider />
            <SettingRow label="Data model">
              <span className="font-mono text-xs text-fg-muted">
                Work &rarr; Edition &rarr; Instance
              </span>
            </SettingRow>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
