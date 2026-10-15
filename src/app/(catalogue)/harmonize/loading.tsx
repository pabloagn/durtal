import { RefreshCw, Sparkles } from "lucide-react";
import { CATEGORIES, HarmonizeTitle, IconLabel, StatContent } from "./frame";
import "./harmonize.css";

/**
 * Harmonize while the catalogue is scanned, drawn in the page's own layout:
 * its header with the scan under way, the four category cards, the tabs and
 * the toolbar, held, then the workspace's box. Each sits where the page puts it
 * (task 0611).
 */
export default function Loading() {
  return (
    <div className="harmonize" role="status" aria-label="Scanning catalogue quality">
      <header className="h-header">
        <HarmonizeTitle />
        <div className="h-scan-control">
          <button className="h-button" disabled aria-busy="true">
            <IconLabel icon={RefreshCw} busy>
              Scan library
            </IconLabel>
          </button>
          {/* Short enough for one line at 320, as the page's own line is (task 0616) */}
          <p>Scanning the catalogue</p>
        </div>
      </header>
      <div className="h-stats">
        {CATEGORIES.map((key, index) => (
          <div key={key} className="h-stat">
            <StatContent category={key} index={index} count="—" />
          </div>
        ))}
      </div>
      <div className="h-workspace-top">
        <div className="h-tabs">
          {["To resolve", "Dismissed", "Activity"].map((label) => (
            <button key={label} disabled className={label === "To resolve" ? "h-tab-active" : ""}>
              {label}
              <span>—</span>
            </button>
          ))}
        </div>
        <span className="h-scan-time">Scanning</span>
      </div>
      {/* The toolbar's own controls, held until the scan is in */}
      <div className="h-toolbar">
        <input aria-label="Search findings" disabled placeholder="Find a record or an issue…" />
        <select aria-label="Filter by record type" disabled>
          <option>All record types</option>
        </select>
        <button className="h-filter" disabled>
          <IconLabel icon={Sparkles}>
            Ready to fix <span className="h-filter-count">—</span>
          </IconLabel>
        </button>
      </div>
      <div className="h-workspace motion-safe:animate-pulse" />
    </div>
  );
}
