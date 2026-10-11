import { ReaderDefaults } from "./reader-defaults";
import { LookupSettingsGroup } from "./lookup-settings";
import { DictionariesGroup } from "./dictionaries";
import { LookupHistoryGroup } from "./lookup-history";
import { getReaderPreferences, getReaderBookOverrides } from "@/lib/ebooks/preferences";
export const metadata = { title: "Reader settings" };
export default async function ReaderSettingsPage() {
  const bounded = <T,>(work: Promise<T>): Promise<T> => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error("Reading settings took too long to load.")), 10000);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const [preferences, overrides] = await Promise.allSettled([bounded(getReaderPreferences(null)), bounded(getReaderBookOverrides({ deviceClass: "desktop", page: 1 }))]);
  return <><ReaderDefaults initial={preferences.status === "fulfilled" ? preferences.value : { ok: false, error: "Reading settings could not be loaded. Please reload this page." }}
    initialOverrides={overrides.status === "fulfilled" ? overrides.value : { ok: false, error: "Book overrides could not be loaded." }} />
    <LookupSettingsGroup /><DictionariesGroup /><LookupHistoryGroup />
  </>;
}
