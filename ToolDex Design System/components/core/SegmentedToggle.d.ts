import React from 'react';

/** SegmentedToggle — connected mutually-exclusive options (unit/mode switches). */
export interface SegmentedToggleProps {
  /** Option list — strings, or {value,label} objects. */
  options: Array<string | { value: string; label: React.ReactNode }>;
  /** Currently-selected value. */
  value: string;
  onChange?: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function SegmentedToggle(props: SegmentedToggleProps): JSX.Element;
