**What & when:** Wrap a single piece of tool data in its type color so it's identifiable at a glance — anywhere a description, ProShop ID, holder, machine number, location, or preset appears.

```jsx
<DataBadge kind="description">3/8 Bull Mill .125R</DataBadge>
<DataBadge kind="proshop" href="https://…">A-3</DataBadge>
<DataBadge kind="machine">4</DataBadge>                        {/* renders "T4" */}
<DataBadge kind="location">CAB-2 · B3</DataBadge>

{/* Holder color is keyed to its SIZE — same size, same color everywhere: */}
<DataBadge kind="holder">NBT30-SK13C-60</DataBadge>          {/* → cyan */}
<DataBadge kind="holder">NBT30-SK20C-90</DataBadge>          {/* → red  */}

{/* Preset / speeds & feeds inherit the selected MATERIAL's ISO group color: */}
<DataBadge kind="preset" material="304 Stainless">SS 1.500 30-SK13-60 - Rough</DataBadge>  {/* M → */}
<DataBadge kind="preset" isoGroup="N">AL 1.250 30-SK20-90 - Finish</DataBadge>           {/* N → */}
```

Fixed-color kinds carry meaning in the color itself. For `holder`, the color follows the physical holder size (override with `color`); for `preset`, pass `material` (or `isoGroup`) and the chip takes that material group's color — the same rule the app uses for all speeds & feeds.
