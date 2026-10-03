// Small DOM for reading SIGARRA pages. parse5 builds the tree the way browsers do (closes
// stray <p>s, adds <tbody>), which matters for SIGARRA's loose HTML; css-select queries it.

import { parse } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';
import { selectAll, selectOne } from 'css-select';
import { textContent, nextElementSibling, findOne } from 'domutils';

const spaced = (n) => (n.type === 'text' ? n.data : (n.children || []).map(spaced).join(' '));

const cache = new WeakMap();
const wrap = (node) => {
  if (!node) return null;
  let el = cache.get(node);
  if (!el) cache.set(node, (el = new El(node)));
  return el;
};

class El {
  constructor(node) { this.node = node; }
  querySelector(selector) { return wrap(selectOne(selector, this.node)); }
  querySelectorAll(selector) { return selectAll(selector, this.node).map(wrap); }
  getAttribute(name) { return this.node.attribs?.[name.toLowerCase()] ?? null; }
  getElementById(id) { return wrap(findOne((n) => n.attribs?.id === id, this.node.children || [], true)); }
  get text() { return textContent(this.node); }
  // Text with a space between text nodes, so "<b>AB1</b><br>9:00" reads "AB1 9:00", not "AB19:00".
  get spacedText() { return spaced(this.node); }
  get tagName() { return (this.node.name || '').toUpperCase(); }
  get nextElementSibling() { return wrap(nextElementSibling(this.node)); }
  hasClass(name) { return (this.node.attribs?.class || '').split(/\s+/).includes(name); }
  // Nearest ancestor with this tag name.
  closest(tag) {
    for (let n = this.node.parent; n; n = n.parent) if (n.name === tag) return wrap(n);
    return null;
  }
}

export function parseHtml(html) {
  return wrap(parse(String(html ?? ''), { treeAdapter: adapter }));
}
