**What & when:** Any single-line text or number entry in a tool form or settings.

```jsx
<Input label="Diameter" type="number" value={d} onChange={e=>setD(e.target.value)} />
<Input label="Description" required error={err} value={v} onChange={...} />
```

Labels are uppercase micro-caps. Omit `label` for a bare `.field-input` (e.g. inside a custom row). Use monospace context for numeric fields where it reads as data.
