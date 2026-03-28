import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Settings" };

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
            <h2 className="font-serif text-base text-fg-primary">Database</h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-fg-secondary">Provider</span>
                <span className="font-mono text-xs text-fg-primary">Neon</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-secondary">Status</span>
                <span className="font-mono text-xs text-accent-sage">
                  Connected
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-base text-fg-primary">
              External APIs
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-fg-secondary">Google Books</span>
                <span className="font-mono text-xs text-fg-muted">
                  {process.env.GOOGLE_BOOKS_API_KEY
                    ? "Configured"
                    : "Not configured"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-secondary">Open Library</span>
                <span className="font-mono text-xs text-accent-sage">
                  Available (no key required)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-base text-fg-primary">
              Storage (S3)
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-fg-secondary">Bucket</span>
                <span className="font-mono text-xs text-fg-primary">
                  {process.env.S3_BUCKET ?? "durtal"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-secondary">Region</span>
                <span className="font-mono text-xs text-fg-primary">
                  {process.env.AWS_REGION ?? "us-east-1"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-base text-fg-primary">About</h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-fg-secondary">Application</span>
                <span className="font-serif text-fg-primary">Durtal</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-secondary">Version</span>
                <span className="font-mono text-xs text-fg-muted">0.1.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-secondary">Data model</span>
                <span className="font-mono text-xs text-fg-muted">
                  Work &rarr; Edition &rarr; Instance
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
