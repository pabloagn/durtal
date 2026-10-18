import { ReaderDefaults } from "./reader-defaults";
import { LookupSettingsGroup } from "./lookup-settings";
import { DictionariesGroup } from "./dictionaries";
import { LookupHistoryGroup } from "./lookup-history";
import { getReaderPreferences, getReaderBookOverrides } from "@/lib/ebooks/preferences";
import { getLookupSettings } from "@/lib/actions/reader-lookup";
export const metadata = { title: "Reader settings" };
export default async function ReaderSettingsPage() {
  const bounded = <T,>(work: Promise<T>): Promise<T> => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error("Reading settings took too long to load.")), 10000);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  // The lookup sources come with the page, so the group shows at its full height at once (SLN-875)
  const [preferences, overrides, lookup] = await Promise.allSettled([bounded(getReaderPreferences(null)),
    bounded(getReaderBookOverrides({ deviceClass: "desktop", page: 1 })), bounded(getLookupSettings())]);
  return <><ReaderDefaults initial={preferences.status === "fulfilled" ? preferences.value : { ok: false, error: "Reading settings could not be loaded. Please reload this page." }}
    initialOverrides={overrides.status === "fulfilled" ? overrides.value : { ok: false, error: "Book overrides could not be loaded." }} />
    <LookupSettingsGroup initial={lookup.status === "fulfilled" ? lookup.value : null} /><DictionariesGroup /><LookupHistoryGroup />
  </>;
}
