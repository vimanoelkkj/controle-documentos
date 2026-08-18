export default function MockupStyle({ css }: { css: string }) {
  return <style data-claude-mockup>{css}</style>;
}
