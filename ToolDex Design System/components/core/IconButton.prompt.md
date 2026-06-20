**What & when:** Compact icon-only action — refresh, edit/duplicate/export on a card, grid/list view toggle.

```jsx
<IconButton title="Grid view" active={view==='grid'} onClick={() => setView('grid')}>
  <LayoutGrid size={15} />
</IconButton>
```

Always set `title` (it doubles as the aria-label). Use `active` for the selected option in a toggle pair.
