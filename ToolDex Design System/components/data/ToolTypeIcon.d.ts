import React from 'react';

/**
 * ToolTypeIcon — hand-drawn line silhouette for a CNC tool type. The signature
 * ToolDex iconography; strokes use currentColor so the icon tints to context.
 *
 * @startingPoint section="ToolDex" subtitle="The CNC tool-type icon set" viewport="700x180"
 */
export interface ToolTypeIconProps {
  /** Tool type key, e.g. 'flat end mill', 'drill', 'tap', 'face mill'. Unknown → generic mill. */
  type: string;
  /** Pixel size of the square icon. @default 22 */
  size?: number;
  /** SVG stroke width. @default 1.5 */
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function ToolTypeIcon(props: ToolTypeIconProps): JSX.Element;
