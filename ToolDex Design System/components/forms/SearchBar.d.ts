import React from 'react';

/** SearchBar — the library's recessed search field with leading icon + clear. */
export interface SearchBarProps {
  value?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function SearchBar(props: SearchBarProps): JSX.Element;
