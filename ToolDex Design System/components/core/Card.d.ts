import React from 'react';

/** Card — the base surface container (surface fill, hairline border, 8px radius, subtle shadow). */
export interface CardProps {
  /** Element/tag to render. @default "div" */
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
