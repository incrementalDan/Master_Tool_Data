import React from 'react';

/**
 * DataBadge — a color-coded chip keyed to a CNC data type. Lets a value be
 * recognized with no label. Most kinds have a fixed color (description=violet,
 * proshop=amber, machine=green, location=indigo); two are dynamic:
 *   • holder — color follows the HOLDER SIZE (taper-collet-gauge)
 *   • preset — color follows the selected MATERIAL's ISO 513 group
 */
export interface DataBadgeProps {
  /** Which data type this value is — sets the color + shape. @default "description" */
  kind?: "description" | "proshop" | "holder" | "machine" | "location" | "preset" | "no-fusion";
  children: React.ReactNode;
  /** If set, renders as an external link (used by ProShop IDs). */
  href?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** kind="preset": material name/query — resolved to its ISO group color. */
  material?: string;
  /** kind="preset": ISO 513 group id, if known. Overrides `material`. */
  isoGroup?: "P" | "M" | "K" | "N" | "S" | "H";
  /** Force an explicit accent color (CSS color). Overrides holder/material resolution. */
  color?: string;
  style?: React.CSSProperties;
}

export function DataBadge(props: DataBadgeProps): JSX.Element;
