**What & when:** The primary object in the ToolDex library — render a tool as a card (grid) or row (list). Composes `ToolTypeIcon` and `DataBadge`.

```jsx
<div className="tool-grid">
  <ToolCard tool={{ tool_type:'drill', description:'PS D-53 5/16 Carbide drill 1.693 LOC',
    proshop_id:'D-53', machine_tool_number:4, diameter:0.3125, number_of_flutes:2, vendor:'Haas' }}
    onOpen={() => openTool(id)} />
</div>
```

Pass `variant="list"` inside a `.tool-list`. The `actions` slot takes a hover-reveal `.card-actions` group of `IconButton`s (edit / duplicate / export).
