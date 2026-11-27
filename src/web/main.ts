/**
 * FINAL-3.3.2.1: точка входа DSS.
 *
 * Здесь только DOM-контекст, первичный запуск и подписки на события.
 * Выбор и рендеринг страниц — в `app-render.ts`; маршрутизация — в `routing.ts`.
 */
import { handleAppClick, renderApp } from "./app-render";

const root = document.getElementById("app")!;

function render(): void {
  void renderApp(root, window.location.hash);
}

document.addEventListener("click", (event) => {
  handleAppClick(event.target, render);
});

document.querySelector("[data-ds-menu]")?.addEventListener("click", () => {
  document.querySelector("[data-ds-sidebar]")?.classList.toggle("is-open");
});

window.addEventListener("hashchange", render);
render();