import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AppProvider } from './AppContext.jsx';

// Executing the component body (which renderToString does) evaluates every
// useEffect dependency array — this catches temporal-dead-zone ReferenceErrors
// like referencing a useCallback before it's defined, which blanks the app but
// passes lint/build.
describe('AppProvider', () => {
  it('renders without crashing on mount', () => {
    expect(() => renderToString(<AppProvider><div /></AppProvider>)).not.toThrow();
  });
});
