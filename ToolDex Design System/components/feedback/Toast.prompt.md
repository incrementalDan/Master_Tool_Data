**What & when:** Confirm an action or surface an error without blocking — "Exported ProShop CSV", "Saved to library", "Sign-in failed".

```jsx
<ToastStack toasts={toasts} onDismiss={dismiss} />
// or a single one:
<Toast type="success" message="Exported ProShop CSV" />
```

Three types only: `success` (green), `error` (red), `info` (blue). Keep messages to one line. The host manages auto-dismiss timing.
