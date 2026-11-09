import assert from "node:assert/strict";
import test from "node:test";
import { parseTranslatedTitles } from "../lib/titleTranslation.js";

const originals = [{ id: 11, title: "Why does the sky look blue?" }, { id: 12, title: "Minecraft" }];

test("переводы связываются со статьями по id независимо от порядка ответа", () => {
  const result = [{ id: 12, title: "Minecraft" }, { id: 11, title: "Почему небо кажется голубым?" }];
  assert.deepEqual(parseTranslatedTitles(JSON.stringify(result), originals), result);
});

test("строчное начало русского заголовка исправляется, фирменный регистр сохраняется", () => {
  const result = [{ id: 11, title: "«ёлки» возвращаются в кино" }, { id: 12, title: "iPhone получает обновление" }];
  assert.deepEqual(parseTranslatedTitles(JSON.stringify(result), originals), [
    { id: 11, title: "«Ёлки» возвращаются в кино" }, result[1],
  ]);
});

test("ответ не сохраняется при пропуске, дублировании или подмене id", () => {
  const title = "Почему небо кажется голубым?";
  for (const ids of [[11], [11, 11], [11, 13]]) {
    assert.equal(parseTranslatedTitles(JSON.stringify(ids.map(id => ({ id, title }))), originals), null);
  }
});

test("обрыв JSON, пустой перевод и служебный ответ не принимаются", () => {
  assert.equal(parseTranslatedTitles('[{"id":11,"title":"Почему', originals), null);
  for (const title of ["  ", "NO_CONTENT", "Title\nMore text"]) {
    assert.equal(parseTranslatedTitles(JSON.stringify([{ id: 11, title }, originals[1]]), originals), null);
  }
});
