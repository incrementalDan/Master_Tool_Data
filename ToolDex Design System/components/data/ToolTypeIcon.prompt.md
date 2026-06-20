**What & when:** Render the line-art icon for a CNC tool type — use in tool cards, type pickers, detail headers, and anywhere a tool needs visual identity.

```jsx
<span className="tool-card-icon"><ToolTypeIcon type="flat end mill" size={24} /></span>
```

Strokes use `currentColor`, so set the color on a wrapper. Known types include: `flat end mill`, `ball end mill`, `bull nose end mill`, `radius mill`, `tapered mill`, `chamfer mill`, `lollipop mill`, `dovetail`, `slot/key cutter`, `form mill`, `thread mill`, `drill`, `center drill`, `spot drill`, `reamer`, `counter bore`, `counter sink`, `tap`, `boring head`, `face mill`, `turning general`, and the `circle segment …` family. Unknown types fall back to a generic end mill.
