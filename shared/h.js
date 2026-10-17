export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "className") node.className = value;
    else if (
      key === "value" ||
      key === "checked" ||
      key === "disabled" ||
      key === "hidden"
    )
      node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity))
    if (child != null && child !== false)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return node;
}
export const replace = (node, ...children) =>
  node.replaceChildren(...children.flat().filter(Boolean));
