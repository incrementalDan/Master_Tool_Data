**What & when:** A small either/or switch — inch vs mm, grid vs list intent, mode toggles. Connected segments, one active.

```jsx
<SegmentedToggle value={unit} onChange={setUnit}
  options={[{value:'in',label:'in'},{value:'mm',label:'mm'}]} />
```

Keep to 2–3 short options. For icon-only view toggles, use two `IconButton`s in a `.view-toggle` instead.
