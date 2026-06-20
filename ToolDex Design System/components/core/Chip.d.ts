import React from 'react';

/** Chip — a toggleable pill for faceted filtering or tool-type selection. */
export interface ChipProps {
  /** "filter" = round facet chip; "type" = larger chip with leading icon. @default "filter" */
  variant?: "filter" | "type";
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function Chip(props: ChipProps): JSX.Element;
