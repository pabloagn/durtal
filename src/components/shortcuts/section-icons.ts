import {
  Archive,
  BookOpen,
  BookMarked,
  Building2,
  Film,
  FlaskRound,
  FolderOpen,
  Frame,
  Landmark,
  Layers,
  Library,
  MapPin,
  Route,
  ScanLine,
  Settings,
  Tags,
  ThumbsUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";

/** Each collection's icon: its home, its add action and its dashboard block */
export const DOMAIN_ICONS: Record<WorkKind, LucideIcon> = {
  book: Library,
  perfume: FlaskRound,
  film: Film,
  painting: Frame,
};

/** The sidebar's icon for each section, shared by the menus and the palette */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  "/": BookOpen,
  ...Object.fromEntries(
    WORK_KINDS.map((kind) => [WORK_DOMAINS[kind].basePath, DOMAIN_ICONS[kind]]),
  ),
  "/reading": BookMarked,
  "/people": Users,
  "/publishers": Building2,
  "/organizations": Landmark,
  "/recommenders": ThumbsUp,
  "/series": Layers,
  "/places": MapPin,
  "/provenance": Route,
  "/locations": Archive,
  "/collections": FolderOpen,
  "/taxonomy": Tags,
  "/harmonize": ScanLine,
  "/settings": Settings,
};
