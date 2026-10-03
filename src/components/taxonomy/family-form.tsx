"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import {
  TAXONOMY_SCOPE_OPTIONS,
  taxonomyScopeLabel,
  type TaxonomyLevel,
} from "@/lib/catalogue/taxonomies";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";

export interface FamilyScope {
  kind: WorkKind;
  level: TaxonomyLevel;
}
export interface FamilyFormValue {
  name: string;
  description: string;
  color: string | null;
  hierarchical: boolean;
  scopes: FamilyScope[];
}
export const scopeKey = (scope: FamilyScope) => `${scope.kind}:${scope.level}`;

interface FamilyFormProps {
  value: FamilyFormValue;
  onChange: (value: FamilyFormValue) => void;
  /** System families keep their storage, hierarchy and scopes. */
  isSystem?: boolean;
  /** Scopes that records use: they stay until those records are reassigned. */
  usedScopes?: ReadonlySet<string>;
  /** Hierarchy cannot be turned off while items are nested. */
  hierarchyLocked?: boolean;
  nameError?: string;
}

/**
 * Name, description, colour, hierarchy and the places a family applies to.
 * Only domains that are open are offered; scopes in other domains are kept.
 */
export function FamilyForm({
  value,
  onChange,
  isSystem = false,
  usedScopes,
  hierarchyLocked = false,
  nameError,
}: FamilyFormProps) {
  const enabled = new Set<WorkKind>(getEnabledWorkKinds());
  const options = TAXONOMY_SCOPE_OPTIONS.filter((option) =>
    enabled.has(option.kind),
  );
  const chosen = new Set(value.scopes.map(scopeKey));
  const hidden = value.scopes.filter((scope) => !enabled.has(scope.kind));
  const set = (patch: Partial<FamilyFormValue>) =>
    onChange({ ...value, ...patch });
  const toggle = (scope: FamilyScope, on: boolean) =>
    set({
      scopes: on
        ? [...value.scopes, scope]
        : value.scopes.filter((s) => scopeKey(s) !== scopeKey(scope)),
    });

  return (
    <div className="space-y-4">
      <Input
        label="Name"
        required
        maxLength={200}
        value={value.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="e.g. Reading mood, Shelf section"
        error={nameError}
      />
      <Textarea
        label="Description"
        maxLength={1000}
        value={value.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Optional description of this family"
        rows={3}
      />

      <fieldset className="space-y-1.5">
        <legend className="block text-xs font-medium text-fg-secondary">
          Applies to
        </legend>
        {isSystem ? (
          <p className="text-sm text-fg-secondary">
            {options
              .filter((option) => chosen.has(scopeKey(option)))
              .map((option) => taxonomyScopeLabel(option.kind, option.level))
              .join(", ")}
          </p>
        ) : (
          <div className="space-y-1">
            {options.map((option) => {
              const key = scopeKey(option);
              const used = usedScopes?.has(key) ?? false;
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-default"
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(key)}
                    disabled={used && chosen.has(key)}
                    onChange={(e) => toggle(option, e.target.checked)}
                    className="h-3.5 w-3.5 rounded-sm border-glass-border bg-bg-primary accent-accent-rose"
                  />
                  <span className="text-sm text-fg-secondary">
                    {taxonomyScopeLabel(option.kind, option.level)}
                  </span>
                  {used && chosen.has(key) && (
                    <span className="text-micro text-fg-secondary">
                      in use: reassign those records to remove it
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {hidden.length > 0 && (
          <p className="text-micro text-fg-secondary">
            Also applies to {hidden.length} place
            {hidden.length === 1 ? "" : "s"} in collections that are not open
            yet. Those are kept.
          </p>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-default">
          <input
            type="checkbox"
            checked={value.hierarchical}
            disabled={isSystem || (hierarchyLocked && value.hierarchical)}
            onChange={(e) => set({ hierarchical: e.target.checked })}
            className="h-3.5 w-3.5 rounded-sm border-glass-border bg-bg-primary accent-accent-rose"
          />
          <span className="text-xs font-medium text-fg-secondary">
            Hierarchical
          </span>
        </label>
        <p className="pl-5.5 text-micro text-fg-secondary">
          {isSystem
            ? "Built-in families keep their structure."
            : hierarchyLocked && value.hierarchical
              ? "Items are nested. Move them to the top level to turn this off."
              : "Items can be nested under other items."}
        </p>
      </div>

      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-fg-secondary">
          Color
        </span>
        <div className="flex items-center gap-2">
          <TaxonomyColorPicker
            value={value.color}
            onChange={(color) => set({ color })}
          />
          <span className="font-mono text-xs text-fg-secondary">
            {value.color ?? "None"}
          </span>
        </div>
      </div>
    </div>
  );
}
