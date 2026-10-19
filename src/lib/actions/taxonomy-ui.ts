"use server";

import * as actions from "./taxonomy-families";
import { actionResult } from "./action-result";

export async function createTaxonomyItem(...args: Parameters<typeof actions.createTaxonomyItem>) {
  return actionResult(() => actions.createTaxonomyItem(...args));
}

export async function updateTaxonomyItem(...args: Parameters<typeof actions.updateTaxonomyItem>) {
  return actionResult(() => actions.updateTaxonomyItem(...args));
}

export async function deleteTaxonomyItem(...args: Parameters<typeof actions.deleteTaxonomyItem>) {
  return actionResult(() => actions.deleteTaxonomyItem(...args));
}

export async function mergeTaxonomyItems(...args: Parameters<typeof actions.mergeTaxonomyItems>) {
  return actionResult(() => actions.mergeTaxonomyItems(...args));
}

export async function reorderTaxonomyItems(...args: Parameters<typeof actions.reorderTaxonomyItems>) {
  return actionResult(() => actions.reorderTaxonomyItems(...args));
}

export async function moveTaxonomyItem(...args: Parameters<typeof actions.moveTaxonomyItem>) {
  return actionResult(() => actions.moveTaxonomyItem(...args));
}

export async function createTaxonomyFamily(...args: Parameters<typeof actions.createTaxonomyFamily>) {
  return actionResult(() => actions.createTaxonomyFamily(...args));
}

export async function updateTaxonomyFamily(...args: Parameters<typeof actions.updateTaxonomyFamily>) {
  return actionResult(() => actions.updateTaxonomyFamily(...args));
}

export async function deleteTaxonomyFamily(...args: Parameters<typeof actions.deleteTaxonomyFamily>) {
  return actionResult(() => actions.deleteTaxonomyFamily(...args));
}

export async function reorderFamilies(...args: Parameters<typeof actions.reorderFamilies>) {
  return actionResult(() => actions.reorderFamilies(...args));
}

export async function setTaxonomyApplicability(...args: Parameters<typeof actions.setTaxonomyApplicability>) {
  return actionResult(() => actions.setTaxonomyApplicability(...args));
}

export async function replaceTaxonomyAssignments(...args: Parameters<typeof actions.replaceTaxonomyAssignments>) {
  return actionResult(() => actions.replaceTaxonomyAssignments(...args));
}

export async function searchTaxonomyItems(...args: Parameters<typeof actions.searchTaxonomyItems>) {
  return actionResult(() => actions.searchTaxonomyItems(...args));
}
