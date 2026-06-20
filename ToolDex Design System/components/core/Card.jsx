import React from 'react';

// ToolDex — Card
// The base surface container. A plain bordered panel with the standard
// surface fill, hairline border, 8px radius and a subtle shadow.

export function Card({ as: Tag = 'div', className = '', style, children, ...rest }) {
  return (
    <Tag className={['card', className].filter(Boolean).join(' ')} style={style} {...rest}>
      {children}
    </Tag>
  );
}
