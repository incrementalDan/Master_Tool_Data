**What & when:** Persistent in-context status — Drive disconnected, library needs migration, demo-mode notice. Sits under the topbar or inside a panel.

```jsx
<Banner tone="warn" icon={<AlertTriangle size={16} />}
  action={<Button variant="secondary" size="sm">Open Settings</Button>}>
  Google Drive disconnected — metadata changes won't be saved.
</Banner>
```

Tones: `info` (blue), `warn` (amber), `error` (red). For transient confirmations use `Toast`, not a banner.
