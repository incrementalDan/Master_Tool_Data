import React from 'react';

/** IconButton — a 28×28 square icon-only control for toolbars & card actions. */
export interface IconButtonProps {
  /** Selected/toggled-on state (blue tint). @default false */
  active?: boolean;
  disabled?: boolean;
  /** Tooltip + accessible label. */
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
  /** A single lucide icon, ~14–15px. */
  children: React.ReactNode;
}

export function IconButton(props: IconButtonProps): JSX.Element;
