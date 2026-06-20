import React from 'react';

/** Select — native dropdown restyled with a theme chevron, optionally labeled. */
export interface SelectProps {
  label?: string;
  required?: boolean;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Options as strings or {value,label}. Or pass <option> children. */
  options?: Array<string | { value: string; label: string }>;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export function Select(props: SelectProps): JSX.Element;
