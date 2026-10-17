type Listener = (event: { collection: string }) => void;

const listeners = new Set<Listener>();

export function publish(collection: string) {
  const event = { collection };
  for (const listener of listeners) listener(event);
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
