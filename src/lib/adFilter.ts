// Общий для всех изданий фильтр рекламных материалов (DIS-41): распродажи,
// подборки скидок, купоны, партнёрские шопинг-разделы. Применяется по
// заголовку и адресу ДО скачивания страницы и запроса к модели — на такие
// материалы квота не тратится. Своё для отдельного издания — в
// adTitlePattern/adLinkPattern у источника (src/config/sources.ts): там
// шаблоны, которые для всех разом дали бы ложные срабатывания.
//
// Сюда попадает только то, что на неделе реальных статей всех изданий (4,7
// тыс.) не задело ни одной обычной новости. Поэтому здесь НЕТ:
//  - слов "deal"/"deals" самих по себе — "Trump Revives Iran Deal Hopes",
//    "Equity Deals Cool in Europe" (Bloomberg); только в связках вроде "best …
//    deals", "deals under", "Prime Day deals";
//  - "price drop", "all-time low", "lowest price" без уточнения — это и про
//    нефть с валютами ("Fuel Price Drop");
//  - "save N" без знака доллара или процента — "save 11,000 jobs", а с суммой
//    в миллионах — "Save $40 Million Every Year On Fuel".
// Что шаблоны пропустили ("…Is Finally Cheap Enough", "15 Best Office
// Chairs"), добирает модель тегом shopping (см. src/lib/prompt.ts).

const AD_TITLE_PATTERN = new RegExp(
  [
    // Распродажи по названию.
    String.raw`\b(?:prime day|prime big deal days?|black friday|cyber monday)\b`,
    // Купоны и промокоды (партнёрская рубрика Wired и других).
    String.raw`\b(?:promo codes?|coupons?|discount codes?)\b`,
    // "40% Off", "$80 Off", "$450+ off", "Save $20", "Save up to 53%".
    String.raw`\d+% off\b`,
    String.raw`\$\d+(?:\.\d+)?\+? off\b`,
    String.raw`\bsave (?:you )?(?:up to )?(?:\$\d[\d,.]*\b(?! ?(?:million|billion|trillion|[mb]n?\b))|\d+%)`,
    // "Lowest Price Ever/Yet", "Buy 2, Get 1 Free", "$30 Cheaper Right Now".
    String.raw`\blowest price (?:ever|yet)\b`,
    String.raw`\brecord[- ]low price\b`,
    String.raw`\bbuy \d+,? get \d+\b`,
    String.raw`\$\d+ cheaper\b`,
    // "Deals: …", "Best … Deals", "Deals Under $50", "Early/Amazon Deals".
    String.raw`\bdeals:`,
    String.raw`\bbest [^:]{0,60}\bdeals\b`,
    String.raw`\bdeals (?:on|under|to shop|you can|we|right now|still|are)\b`,
    String.raw`\b(?:early|amazon|walmart|best buy|target) deals\b`,
    // "Is On Sale", "On Sale Right Now", "… at Amazon Today".
    String.raw`\bon sale (?:right )?now\b`,
    String.raw`\b(?:is|are) on sale\b`,
    String.raw`\bat amazon (?:today|right now)\b`,
  ].join("|"),
  "i"
);

// По пути ссылки, без домена и query.
const AD_LINK_PATTERN = new RegExp(
  [
    // Шопинг-разделы: Rolling Stone /product-recommendations/, Variety и
    // Hollywood Reporter /shopping/, оплаченный /ad/ у Lifehacker.
    String.raw`/(?:shopping|product-recommendations|deals|coupons|gift-guides?|ad)/`,
    String.raw`prime-(?:big-)?(?:day|deal)`,
    String.raw`black-friday|cyber-monday`,
    String.raw`lowest-price`,
    // "…-deals-10-06-26", "best-…-deals", "…-sale-october-2026".
    String.raw`deals-\d{1,2}-\d{1,2}-\d{2,4}`,
    String.raw`(?:best|early|amazon|sale)-[a-z0-9-]*deals`,
    String.raw`-sale-(?:january|february|march|april|may|june|july|august|september|october|november|december)-20\d\d`,
    String.raw`buy-\d+-get-\d+`,
  ].join("|"),
  "i"
);

export function isAd(title: string, link: string): boolean {
  if (AD_TITLE_PATTERN.test(title)) return true;
  const path = link.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  return AD_LINK_PATTERN.test(path);
}
