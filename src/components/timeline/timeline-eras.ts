export interface TimelineEra {
  label: string;
  startYear: number;
  endYear: number;
  /** CSS custom property name (without var()) or hex color */
  color: string;
}

export const TIMELINE_ERAS: TimelineEra[] = [
  { label: "Antiquity",      startYear: -3000, endYear: 500,  color: "var(--color-accent-gold)" },
  { label: "Medieval",       startYear: 500,   endYear: 1400, color: "var(--color-accent-slate)" },
  { label: "Renaissance",    startYear: 1400,  endYear: 1600, color: "var(--color-accent-sage)" },
  { label: "Baroque",        startYear: 1600,  endYear: 1715, color: "var(--color-gothic-mulberry)" },
  { label: "Enlightenment",  startYear: 1715,  endYear: 1789, color: "var(--color-accent-gold)" },
  { label: "Romanticism",    startYear: 1789,  endYear: 1850, color: "var(--color-accent-rose)" },
  { label: "Realism",        startYear: 1850,  endYear: 1900, color: "var(--color-accent-slate)" },
  { label: "Modernism",      startYear: 1900,  endYear: 1945, color: "var(--color-accent-plum)" },
  { label: "Postmodernism",  startYear: 1945,  endYear: 2000, color: "var(--color-gothic-crimson)" },
  { label: "Contemporary",   startYear: 2000,  endYear: 2030, color: "var(--color-accent-sage)" },
];
