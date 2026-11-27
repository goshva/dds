/**
 * TPL-2: минимальный изолированный скрипт reference-эталонов.
 * Не обращается к production API, не содержит маршрутизатора и не выполняет расчётов.
 * Единственные задачи: мобильное меню и подсветка активного пункта навигации.
 */
(function () {
  "use strict";

  var menu = document.querySelector("[data-ds-menu]");
  var sidebar = document.querySelector("[data-ds-sidebar]");
  var scrim = document.querySelector("[data-ds-scrim]");

  function closeMenu() {
    if (sidebar) sidebar.classList.remove("is-open");
    if (scrim) scrim.classList.remove("is-open");
  }

  if (menu) {
    menu.addEventListener("click", function () {
      if (!sidebar) return;
      sidebar.classList.toggle("is-open");
      if (scrim) scrim.classList.toggle("is-open");
    });
  }
  if (scrim) scrim.addEventListener("click", closeMenu);

  // Активный пункт навигации определяется по имени текущего файла — без маршрутизатора.
  var current = window.location.pathname.split("/").pop() || "index.html";
  var links = document.querySelectorAll(".ds-nav a");
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute("href") || "";
    var matches = href === current || (current === "index.html" && href === "index.html");
    if (matches) links[i].setAttribute("aria-current", "page");
  }
})();
