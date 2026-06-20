import React from 'react';

/** Badge — a neutral inline fact chip (with optional blue/orange accent). */
export interface BadgeProps {
  /** @default "neutral" */
  variant?: "neutral" | "blue" | "orange";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function Badge(props: BadgeProps): JSX.Element;
