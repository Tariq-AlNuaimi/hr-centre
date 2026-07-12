import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

// MDX component map for docs pages (ADR-053). Extend here to expose shared
// primitives (e.g. Callout variants) to `content/docs/**` authors.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
  };
}
