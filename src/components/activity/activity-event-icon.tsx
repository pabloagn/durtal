"use client";

import {
  Plus,
  Trash2,
  Pencil,
  Settings2,
  Star,
  BookMarked,
  UserPlus,
  UserMinus,
  ImagePlus,
  ImageMinus,
  Image,
  Images,
  RefreshCw,
  Tag,
  BookOpen,
  Package,
  FolderPlus,
  FolderMinus,
  MessageSquare,
  FileText,
  Globe,
  MapPin,
  List,
  type LucideIcon,
} from "lucide-react";
import { EVENT_CONFIG } from "@/lib/activity/event-config";

const ICON_MAP: Record<string, LucideIcon> = {
  Plus,
  Trash2,
  Pencil,
  Settings2,
  Star,
  BookMarked,
  UserPlus,
  UserMinus,
  ImagePlus,
  ImageMinus,
  Image,
  Images,
  RefreshCw,
  Tag,
  BookOpen,
  Package,
  FolderPlus,
  FolderMinus,
  MessageSquare,
  FileText,
  Globe,
  MapPin,
  List,
};

interface ActivityEventIconProps {
  eventKey: string;
  className?: string;
}

export function ActivityEventIcon({ eventKey, className }: ActivityEventIconProps) {
  const config = EVENT_CONFIG[eventKey];
  const iconName = config?.icon ?? "Settings2";
  const color = config?.color ?? "var(--color-fg-muted)";
  const Icon = ICON_MAP[iconName] ?? Settings2;

  return <Icon className={className} style={{ color }} strokeWidth={1.5} />;
}
