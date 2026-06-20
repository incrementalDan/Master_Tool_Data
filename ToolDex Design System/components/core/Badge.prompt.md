**What & when:** Small inline facts on a tool card or row — diameter, flute count, coating, vendor. Neutral by default; `blue` highlights a preferred machine.

```jsx
<Badge>⌀ 0.375 in</Badge>
<Badge>4FL</Badge>
<Badge variant="blue">VF-2</Badge>
```

For data that has a *type identity* (description, ProShop ID, machine #, location, preset) use `DataBadge` — its color carries meaning. `Badge` is for neutral specs.
