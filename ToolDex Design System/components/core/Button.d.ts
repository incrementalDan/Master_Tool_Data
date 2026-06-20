import React from 'react';

/**
 * Button — the ToolDex action primitive.
 *
 * @startingPoint section="ToolDex" subtitle="Buttons, sizes & intents" viewport="700x150"
 */
export interface ButtonProps {
  /** Intent / weight. @default "secondary" */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success" | "orange";
  /** @default "md" */
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
  /** Label, optionally led by a lucide icon. */
  children: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
