/**
 * TPL-4.1: сборка HTML-документа эталона.
 * Оболочка собирается production-компонентами appShell/sidebar/topbar; собственной разметки компонентов нет.
 */
import { appShell, sidebar, topbar } from "../../src/web/components/index";
import { trusted, type TrustedHtml } from "../../src/web/lib/format";
import { PAGES, type PageKey } from "./fixtures/common";

export interface DocumentInput {
  title: string;
  cssHref: string;
  jsHref: string;
  topbarTitle: string;
  navCurrent: PageKey | null;
  content: TrustedHtml;
}

export function renderDocument(input: DocumentInput): string {
  const shell = appShell({
    sidebar: sidebar({
      brandName: "DSS",
      brandSub: "прогнозирование заказов",
      sections: [
        {
          title: "Эталоны страниц",
          items: [
            { href: "index.html", label: "Индекс", current: input.navCurrent === null },
            ...PAGES.map((page) => ({ href: page.file, label: page.navLabel, current: page.key === input.navCurrent })),
          ],
        },
      ],
    }),
    topbar: topbar({ title: input.topbarTitle, shopNo: "7745", lastUpdated: null, sourceStatus: "OK" }),
    content: input.content,
  });

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${input.title}</title>
<link rel="stylesheet" href="${input.cssHref}" />
</head>
<body>
${shell}
<script src="${input.jsHref}"></script>
</body>
</html>
`;
  // Косметическая нормализация: убирает завершающие пробелы, не меняя разметку компонентов.
  return html
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

/** Индекс эталонов: собирается теми же компонентами, разметка списка — служебная разметка reference. */
export function renderIndexDocument(content: TrustedHtml, cssHref: string, jsHref: string): string {
  return renderDocument({ title: "DSS — эталоны страниц", cssHref, jsHref, topbarTitle: "DSS · эталоны интерфейса", navCurrent: null, content });
}

export function indexContent(headerHtml: TrustedHtml, listHtml: TrustedHtml, notesHtml: TrustedHtml, banner: TrustedHtml): TrustedHtml {
  return trusted(`${banner}${headerHtml}${listHtml}${notesHtml}`);
}
