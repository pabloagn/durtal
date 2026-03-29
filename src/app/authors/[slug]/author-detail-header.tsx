"use client";

import { useState } from "react";
import Image from "next/image";
import { Pencil, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthorEditDialog } from "./author-edit-dialog";
import { AuthorDeleteButton } from "./author-delete-button";
import { AuthorMediaManagerDialog } from "@/components/media/author-media-manager-dialog";

interface PosterCrop {
  x: number;
  y: number;
  zoom: number;
}

interface AuthorDetailHeaderProps {
  authorId: string;
  name: string;
  realName?: string | null;
  countryName?: string | null;
  lifeDates?: string | null;
  gender?: string | null;
  posterUrl?: string | null;
  posterCrop?: PosterCrop | null;
  workCount: number;
}

export function AuthorDetailHeader({
  authorId,
  name,
  realName,
  countryName,
  lifeDates,
  gender,
  posterUrl,
  posterCrop,
  workCount,
}: AuthorDetailHeaderProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);

  return (
    <>
      <div className="mb-8 flex gap-6">
        {posterUrl ? (
          <div className="relative h-48 w-36 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            <Image
              src={posterUrl}
              alt={`${name} portrait`}
              fill
              sizes="144px"
              className="object-cover"
              style={
                posterCrop &&
                (posterCrop.x !== 50 || posterCrop.y !== 50 || posterCrop.zoom !== 100)
                  ? {
                      objectPosition: `${posterCrop.x}% ${posterCrop.y}%`,
                      transform: `scale(${posterCrop.zoom / 100})`,
                      transformOrigin: `${posterCrop.x}% ${posterCrop.y}%`,
                    }
                  : undefined
              }
              unoptimized
            />
          </div>
        ) : (
          <div className="flex h-48 w-36 flex-shrink-0 items-center justify-center rounded-sm bg-bg-tertiary">
            <span className="font-serif text-4xl text-fg-muted/20">
              {name[0]}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
                {name}
              </h1>
              {realName && realName !== name && (
                <p className="mt-1 text-sm text-fg-muted italic">
                  {realName}
                </p>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-fg-muted hover:text-fg-primary"
                onClick={() => setMediaOpen(true)}
              >
                <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
                Media
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-fg-muted hover:text-fg-primary"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.5} />
                Edit
              </Button>
              <AuthorDeleteButton
                authorId={authorId}
                name={name}
                workCount={workCount}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-fg-secondary">
            {countryName && <span>{countryName}</span>}
            {lifeDates && (
              <span className="font-mono text-xs text-fg-muted">
                {lifeDates}
              </span>
            )}
            {gender && (
              <span className="text-xs text-fg-muted">{gender}</span>
            )}
          </div>
        </div>
      </div>

      <AuthorEditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        authorId={authorId}
      />

      <AuthorMediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        authorId={authorId}
        authorName={name}
      />
    </>
  );
}
