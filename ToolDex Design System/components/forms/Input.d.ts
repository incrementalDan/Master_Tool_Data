import React from 'react';

/** Input — a labeled, recessed text/number field with focus-blue border. */
export interface InputProps {
  /** Uppercase micro-label above the field. Omit for a bare input. */
  label?: string;
  required?: boolean;
  /** Error message — also turns the border red. */
  error?: string;
  /** Helper text shown below when there is no error. */
  hint?: string;
  type?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Input(props: InputProps): JSX.Element;
