import { PageHeader } from "@/components/layout/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Defaults for new records, display, the reader, outside services and your data"
      />
      <div className="grid gap-8 md:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
        <SettingsNav />
        <div className="min-w-0 max-w-3xl">{children}</div>
      </div>
    </>
  );
}
