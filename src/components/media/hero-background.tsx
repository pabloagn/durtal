"use client";

import Image from "next/image";
import { UploadZone } from "./upload-zone";
import type { MediaType } from "@/lib/types";

interface HeroBackgroundProps {
  imageUrl?: string | null;
  entityType: "work" | "author";
  entityId: string;
  editable?: boolean;
  onUploadComplete?: () => void;
  children: React.ReactNode;
}

export function HeroBackground({
  imageUrl,
  entityType,
  entityId,
  editable = false,
  onUploadComplete,
  children,
}: HeroBackgroundProps) {
  return (
    <div className="relative mb-8">
      {/* Background image */}
      {imageUrl ? (
        <div className="absolute inset-0 -mx-8 -mt-8 h-64 overflow-hidden">
          <Image
            src={imageUrl}
            alt="Background"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-b from-bg-primary/40 via-bg-primary/70 to-bg-primary" />
        </div>
      ) : editable ? (
        <div className="absolute inset-0 -mx-8 -mt-8 h-64">
          <UploadZone
            entityType={entityType}
            entityId={entityId}
            mediaType="background"
            onUploadComplete={onUploadComplete}
            className="h-full"
          />
        </div>
      ) : null}

      {/* Content overlay */}
      <div className={imageUrl || editable ? "relative z-10 pt-32" : ""}>
        {children}
      </div>
    </div>
  );
}
