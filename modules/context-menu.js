export function createContextMenuController(menu) {
  function close() {
    menu.classList.add("hidden");
  }

  function show(items, x, y) {
    menu.replaceChildren();
    items.forEach(item => {
      if (item.separator) {
        menu.appendChild(document.createElement("hr"));
        return;
      }
      const button = document.createElement("button");
      button.className = item.danger ? "danger" : "";
      const icon = document.createElement("span");
      icon.textContent = item.icon || "";
      button.append(icon, document.createTextNode(item.label));
      button.addEventListener("click", () => { close(); item.action(); });
      menu.appendChild(button);
    });
    menu.classList.remove("hidden");
    menu.style.left = `${Math.min(x, window.innerWidth - 213)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
  }

  return { show, close };
}
