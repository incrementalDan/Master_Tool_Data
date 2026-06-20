import React from 'react';

/** Spinner — the ToolDex loading ring (blue top on a border-grey track). */
export interface SpinnerProps {
  /** Diameter in px. @default 28 */
  size?: number;
  /** Ring thickness in px. @default 3 */
  borderWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function Spinner(props: SpinnerProps): JSX.Element;
