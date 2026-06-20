**What & when:** Choosing one value from a known set — sort order, material category, vendor, units in a form.

```jsx
<Select label="Sort" value={sort} onChange={e=>setSort(e.target.value)}
  options={[{value:'updated',label:'Recently updated'},{value:'vendor',label:'Vendor A–Z'}]} />
```

The native arrow is replaced with the ToolDex chevron. For 2–3 options consider `SegmentedToggle` instead.
