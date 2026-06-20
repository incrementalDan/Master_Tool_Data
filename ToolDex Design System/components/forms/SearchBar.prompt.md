**What & when:** Top-of-library tool search. Usually flexed full-width beside the "Add Tool" button.

```jsx
<SearchBar value={q} onChange={setQ} autoFocus
  placeholder={`Search ${tools.length} tools…  ( / to focus )`} />
```

The clear button appears only when there's a value. The app convention binds `/` to focus this field.
