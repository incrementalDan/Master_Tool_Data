**What & when:** Any loading state — full-page library load, inline button spinner, reconnect-in-progress.

```jsx
<div className="loading-screen"><Spinner /><span>Loading tool library…</span></div>
<Button variant="primary"><Spinner size={16} borderWidth={2} /> Saving…</Button>
```

Use small (`size={16} borderWidth={2}`) inside buttons. There's only one spinner style across ToolDex.
