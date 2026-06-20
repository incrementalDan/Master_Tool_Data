import React from 'react';

/** A single tool record — only the fields ToolCard reads. */
export interface Tool {
  tool_type?: string;
  type?: string;
  description?: string;
  location?: string;
  proshop_id?: string;
  machine_tool_number?: string | number;
  diameter?: string | number;
  number_of_flutes?: string | number;
  flute_length?: string | number;
  vendor?: string;
  coating?: string;
  preferred_machine?: string;
  unit?: string;
}

/**
 * ToolCard — the core library object. Shows the tool-type icon, description,
 * and a row of data badges (location, ProShop ID, machine #, diameter, flutes…).
 *
 * @startingPoint section="ToolDex" subtitle="Library tool card (grid + list)" viewport="700x150"
 */
export interface ToolCardProps {
  tool: Tool;
  /** Layout. @default "grid" */
  variant?: "grid" | "list";
  onOpen?: (e: React.MouseEvent) => void;
  /** Optional hover-reveal action buttons (render an .card-actions group). */
  actions?: React.ReactNode;
}

export function ToolCard(props: ToolCardProps): JSX.Element;
