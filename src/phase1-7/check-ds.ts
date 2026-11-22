/** Проверка существования и детализации датасетов-кандидатов. */
import { loadCatalog } from "./load";

const cat = loadCatalog();
const ids = [5797, 7775, 7765, 7766, 7399, 7036, 1677, 1787, 4023, 7000, 2498, 7771, 6054, 6386, 6522, 7712, 7713, 7043, 4997, 5799, 5987, 6831, 6836, 6679, 3035, 3466, 4732, 7802, 7021, 7006, 7024, 7027, 7119, 2339, 6863, 7293, 5939, 7473, 7465, 5247, 5399, 7719, 6674, 6673, 6030, 5433, 5211, 5212];
for (const id of ids) {
  const inv = cat.inventoryById.get(id);
  const det = cat.datasetsDetailById.get(id);
  console.log(`${id}\t${inv ? "INV" : "no-inv"}\t${det ? "DETAIL cols=" + det.columns.length : "no-detail"}\t${inv?.name ?? ""}\t${inv?.priority ?? ""}`);
}
