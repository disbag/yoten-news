// Адрес сайта для абсолютных ссылок в превью (og:url, og:image). Переменная
// называется RP_ORIGIN по истории: раньше она же была адресом для passkey.
export const SITE_ORIGIN = process.env.RP_ORIGIN ?? "http://localhost:3000";
