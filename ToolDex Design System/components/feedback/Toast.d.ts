import React from 'react';

/** A single transient notification. Use ToastStack to render a live array. */
export interface ToastProps {
  /** @default "info" */
  type?: "success" | "error" | "info";
  message: React.ReactNode;
  onDismiss?: () => void;
}
export function Toast(props: ToastProps): JSX.Element;

export interface ToastStackProps {
  toasts: Array<{ id: string | number; type?: "success" | "error" | "info"; message: React.ReactNode }>;
  onDismiss?: (id: string | number) => void;
}
/** Fixed bottom-right stack of toasts. */
export function ToastStack(props: ToastStackProps): JSX.Element;
