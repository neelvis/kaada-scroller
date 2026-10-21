export const $ = (selector, root = document) => root.querySelector(selector);
export function node(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'htmlFor') el.htmlFor = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of Array.isArray(children) ? children : [children]) if (child) el.append(child);
  return el;
}
export function button(text, className = 'button', click) { return node('button', { type: 'button', className, text, onclick: click }); }
export function iconTextButton(text, label, className, click) {
  const control = button(text, `${className} has-tooltip`, click);
  control.setAttribute('aria-label', label); control.setAttribute('data-tooltip', label); return control;
}
export function toast(message) { const item = node('div', { className: 'toast', role: 'status', text: message }); document.body.append(item); setTimeout(() => item.remove(), 6500); }
export function plural(value, one, few, many) { const n = Math.abs(value) % 100, m = n % 10; return n > 10 && n < 20 ? many : m > 1 && m < 5 ? few : m === 1 ? one : many; }
export function field(labelText, control) { return node('div', { className: 'field' }, [node('label', { text: labelText }, [control])]); }
export function input(value, type = 'text', attrs = {}) { const el = node('input', { type, ...attrs }); el.value = value ?? ''; return el; }
