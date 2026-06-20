**What & when:** Toggleable filters and tool-type selectors on the library page.

```jsx
<Chip active={sel==='carbide'} onClick={pick}>Carbide</Chip>
<Chip variant="type" active onClick={pick}><ToolTypeIcon type="drill" size={16}/> Drill</Chip>
```

`filter` chips group inside a wrap row for facets (material, coating, vendor). `type` chips carry a `ToolTypeIcon`. Active = blue tint + blue border.
