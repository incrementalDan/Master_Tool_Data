import React from 'react';

/** Banner — a full-width inline status notice (info / warn / error). */
export interface BannerProps {
  /** @default "info" */
  tone?: "info" | "warn" | "error";
  /** Leading lucide icon. */
  icon?: React.ReactNode;
  /** Right-aligned action (usually a small Button). */
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function Banner(props: BannerProps): JSX.Element;
