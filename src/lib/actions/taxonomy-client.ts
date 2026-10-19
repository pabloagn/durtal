"use client";

import * as actions from "./taxonomy-ui";
import type { ActionResult } from "./action-result";
import { ActionRefusal } from "./action-refusal";
async function value<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new ActionRefusal(result.error, result.href);
  return result.value;
}

export async function createTaxonomyItem(...args: Parameters<typeof actions.createTaxonomyItem>) {
  return value(actions.createTaxonomyItem(...args));
}

export async function updateTaxonomyItem(...args: Parameters<typeof actions.updateTaxonomyItem>) {
  return value(actions.updateTaxonomyItem(...args));
}

export async function deleteTaxonomyItem(...args: Parameters<typeof actions.deleteTaxonomyItem>) {
  return value(actions.deleteTaxonomyItem(...args));
}

export async function mergeTaxonomyItems(...args: Parameters<typeof actions.mergeTaxonomyItems>) {
  return value(actions.mergeTaxonomyItems(...args));
}

export async function reorderTaxonomyItems(...args: Parameters<typeof actions.reorderTaxonomyItems>) {
  return value(actions.reorderTaxonomyItems(...args));
}

export async function moveTaxonomyItem(...args: Parameters<typeof actions.moveTaxonomyItem>) {
  return value(actions.moveTaxonomyItem(...args));
}

export async function createTaxonomyFamily(...args: Parameters<typeof actions.createTaxonomyFamily>) {
  return value(actions.createTaxonomyFamily(...args));
}

export async function updateTaxonomyFamily(...args: Parameters<typeof actions.updateTaxonomyFamily>) {
  return value(actions.updateTaxonomyFamily(...args));
}

export async function deleteTaxonomyFamily(...args: Parameters<typeof actions.deleteTaxonomyFamily>) {
  return value(actions.deleteTaxonomyFamily(...args));
}

export async function reorderFamilies(...args: Parameters<typeof actions.reorderFamilies>) {
  return value(actions.reorderFamilies(...args));
}

export async function setTaxonomyApplicability(...args: Parameters<typeof actions.setTaxonomyApplicability>) {
  return value(actions.setTaxonomyApplicability(...args));
}

export async function replaceTaxonomyAssignments(...args: Parameters<typeof actions.replaceTaxonomyAssignments>) {
  return value(actions.replaceTaxonomyAssignments(...args));
}

export async function searchTaxonomyItems(...args: Parameters<typeof actions.searchTaxonomyItems>) {
  return value(actions.searchTaxonomyItems(...args));
}
