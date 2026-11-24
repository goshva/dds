/** Каркас приложения: AppShell, Sidebar, Topbar, PageHeader. */
import { escapeHtml, safeHref, trusted, type TrustedHtml } from "../lib/format";

export interface NavItem { href: string; label: string; current?: boolean }
export interface NavSection { title: string; items: NavItem[] }

export interface TopbarProps {
  title: string;
  shopNo: string;
  lastUpdated: string | null;
  sourceStatus: "OK" | "PARTIAL" | "NOT_AVAILABLE";
  menuOpen?: boolean;
}

export interface AppShellProps {
  /** TrustedHtml: только разметка компонентов DSS, не значения API. */
  sidebar: TrustedHtml;
  topbar: TrustedHtml;
  content: TrustedHtml;
  menuOpen?: boolean;
}

export function sidebar(props: { brandName: string; brandSub: string; sections: NavSection[] }): TrustedHtml {
  const sections = props.sections
    .map((section) => `<div class="ds-nav-section">${escapeHtml(section.title)}</div>${section.items
      .map((item) => `<a href="${safeHref(item.href)}"${item.current ? ' aria-current="page"' : ""}${safeHref(item.href) === "#" && item.href !== "#" ? ' data-ds-unsafe-href="1"' : ""}>${escapeHtml(item.label)}</a>`)
      .join("")}`)
    .join("");
  return trusted(`<aside class="ds-sidebar" data-ds-sidebar>
  <div class="ds-brand">
    <svg class="ds-brand-mark" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 22l6-7 5 4 7-9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><span class="ds-brand-name">${escapeHtml(props.brandName)}</span><span class="ds-brand-sub">${escapeHtml(props.brandSub)}</span></div>
  </div>
  <nav class="ds-nav">${sections}</nav>
</aside>`);
}

export function topbar(props: TopbarProps): TrustedHtml {
  const statusClass = props.sourceStatus === "OK" ? "ds-badge--ok" : props.sourceStatus === "PARTIAL" ? "ds-badge--pending" : "ds-badge--na";
  return trusted(`<header class="ds-topbar">
  <div class="ds-row">
    <button class="ds-burger" type="button" data-ds-menu aria-label="Меню">☰</button>
    <div><div class="ds-card-title">${escapeHtml(props.title)}</div></div>
  </div>
  <div class="ds-row ds-topbar-meta">
    <span>Магазин ${escapeHtml(props.shopNo)}</span>
    <span class="ds-badge ${statusClass}">источник: ${escapeHtml(props.sourceStatus)}</span>
    <span>обновлено: ${props.lastUpdated ? escapeHtml(props.lastUpdated) : "NOT_AVAILABLE"}</span>
  </div>
</header>`);
}

export function pageHeader(props: { title: string; subtitle?: string; right?: TrustedHtml }): TrustedHtml {
  return trusted(`<div class="ds-row" style="align-items:flex-start">
    <div><h1>${escapeHtml(props.title)}</h1>${props.subtitle ? `<p class="ds-sub">${escapeHtml(props.subtitle)}</p>` : ""}</div>
    <span class="ds-spacer"></span>${props.right ?? ""}
  </div>`);
}

export function appShell(props: AppShellProps): TrustedHtml {
  return trusted(`<div class="ds-app">
  ${props.sidebar}
  <div class="ds-scrim${props.menuOpen ? " is-open" : ""}" data-ds-scrim></div>
  <div class="ds-main">${props.topbar}<main class="ds-content">${props.content}</main></div>
</div>`);
}