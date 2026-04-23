/**
 * Lightweight content loaders for plain-text cabinet prose.
 * These functions are intentionally tiny so the content system can grow
 * without forcing a larger UI refactor yet.
 */

export async function loadTextLines(path: string): Promise<string[]> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load text content: ${path}`);
  }
  const text = await res.text();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load JSON content: ${path}`);
  }
  return (await res.json()) as T;
}
