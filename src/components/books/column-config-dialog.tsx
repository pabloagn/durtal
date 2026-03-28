"use client";

import { useState } from "react";
import { GripVertical, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  defaultOrder: number;
}

interface ColumnConfig {
  key: string;
  visible: boolean;
  order: number;
}

interface ColumnConfigDialogProps {
  columns: ColumnConfig[];
  allColumns: ColumnDef[];
  onChange: (cols: ColumnConfig[]) => void;
  onClose: () => void;
}

export function ColumnConfigDialog({
  columns,
  allColumns,
  onChange,
  onClose,
}: ColumnConfigDialogProps) {
  const [local, setLocal] = useState<ColumnConfig[]>(
    [...columns].sort((a, b) => a.order - b.order),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const toggleVisibility = (key: string) => {
    setLocal((prev) =>
      prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)),
    );
  };

  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;

    setLocal((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(idx, 0, moved);
      return next.map((c, i) => ({ ...c, order: i }));
    });
    setDragIndex(idx);
  };

  const handleSave = () => {
    onChange(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/80">
      <div className="w-80 rounded-sm border border-bg-tertiary bg-bg-secondary p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-sm text-fg-primary">
            Configure Columns
          </h3>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg-primary"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mb-4 max-h-64 space-y-1 overflow-y-auto">
          {local.map((col, idx) => {
            const def = allColumns.find((c) => c.key === col.key);
            if (!def) return null;
            return (
              <div
                key={col.key}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                className={`flex cursor-grab items-center gap-2 rounded-sm px-2 py-1.5 transition-colors ${
                  dragIndex === idx ? "bg-bg-tertiary" : "hover:bg-bg-primary"
                }`}
              >
                <GripVertical
                  className="h-3 w-3 flex-shrink-0 text-fg-muted"
                  strokeWidth={1.5}
                />
                <span className="flex-1 text-xs text-fg-secondary">
                  {def.label}
                </span>
                <button
                  onClick={() => toggleVisibility(col.key)}
                  className="text-fg-muted hover:text-fg-secondary"
                >
                  {col.visible ? (
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
